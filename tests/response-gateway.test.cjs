const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { createResponseGateway } = require("../electron/response-gateway.cjs");
const { AIError } = require("../electron/chatgpt.cjs");
const { waitFor } = require("./ai-fixtures.cjs");

const request = (gateway, path = "responses", options = {}) =>
  fetch(`${gateway.baseUrl}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gateway.token}`,
      "content-type": "application/json",
      ...options.headers,
    },
    body: options.body || '{"stream":true}',
    ...Object.fromEntries(
      Object.entries(options).filter(
        ([name]) => !["headers", "body"].includes(name),
      ),
    ),
  });
async function fixture(t, options) {
  const gateway = await createResponseGateway(options);
  t.after(() => gateway.close());
  return gateway;
}
test("the gateway checks credentials per request, retries only explicit expiry once, and streams without buffering", async (t) => {
  const calls = [];
  let credential = "old",
    refreshes = 0,
    checks = 0,
    stream;
  const gateway = await fixture(t, {
    accessToken: async ({ rejectedToken } = {}) => {
      checks++;
      if (rejectedToken) {
        assert.equal(rejectedToken, "old");
        refreshes++;
        credential = "new";
      }
      return credential;
    },
    fetcher: async (url, options) => {
      calls.push({ url, ...options, headers: new Headers(options.headers) });
      if (calls.length === 1)
        return Response.json(
          { error: { code: "token_expired" } },
          { status: 401 },
        );
      return new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
            controller.enqueue(
              Buffer.from("event: response.created\ndata: {}\n\n"),
            );
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "req-renewed",
          },
        },
      );
    },
  });
  const body = zlib.gzipSync(
    Buffer.from('{"stream":true,"input":"private manuscript"}'),
  );
  const response = await request(gateway, "responses", {
    body,
    headers: { "content-encoding": "gzip", originator: "Research_Workbench" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "req-renewed");
  const reader = response.body.getReader();
  assert.match(
    Buffer.from((await reader.read()).value).toString(),
    /response.created/,
  );
  stream.enqueue(Buffer.from("event: response.completed\ndata: {}\n\n"));
  stream.close();
  assert.match(
    Buffer.from((await reader.read()).value).toString(),
    /response.completed/,
  );
  assert.equal((await reader.read()).done, true);
  assert.equal(refreshes, 1);
  assert.equal(checks, 2);
  assert.deepEqual(calls[0].body, body);
  assert.deepEqual(calls[1].body, body);
  assert.equal(calls[1].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[1].headers.get("content-encoding"), "gzip");
  assert.equal(calls[1].headers.get("originator"), "Research_Workbench");
  assert.equal(calls[1].headers.get("authorization"), "Bearer new");
  assert.equal(calls[0].headers.get("authorization"), "Bearer old");
  assert.equal(calls[1].redirect, "error");
  assert.equal(calls[1].credentials, "omit");
  const compact = await request(gateway, "responses/compact");
  await compact.body.cancel();
  assert.equal(checks, 3);
  assert.equal(calls.at(-1).url, "https://api.openai.com/v1/responses/compact");
  assert.equal(refreshes, 1);
});
test("unrecognized 401s and a second expired-token response fail visibly without repeated refresh or replay", async (t) => {
  for (const code of [
    "invalid_api_key",
    "token_expired",
    "subscription_sharing_invalid_user",
  ]) {
    let calls = 0,
      refreshes = 0;
    const gateway = await fixture(t, {
      accessToken: async ({ rejectedToken } = {}) => {
        if (rejectedToken) refreshes++;
        return "fixture-credential";
      },
      fetcher: async () => {
        calls++;
        return Response.json(
          { error: { code } },
          { status: 401, headers: { "x-request-id": "req-rejected" } },
        );
      },
    });
    const response = await request(gateway);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("x-request-id"), "req-rejected");
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls, code === "token_expired" ? 2 : 1);
    assert.equal(refreshes, code === "token_expired" ? 1 : 0);
  }
});
test("a rejected refresh produces a reconnection error without exposing private credentials or sending more inference", async (t) => {
  let calls = 0;
  const gateway = await fixture(t, {
    accessToken: async ({ rejectedToken } = {}) => {
      if (rejectedToken)
        throw new AIError(
          "invalid_grant",
          "Your ChatGPT connection has expired. Reconnect your account.",
        );
      return "private-oauth-token";
    },
    fetcher: async () => {
      calls++;
      return Response.json(
        { error: { code: "token_expired" } },
        { status: 401 },
      );
    },
  });
  const response = await request(gateway);
  assert.equal(response.status, 401);
  const detail = await response.text();
  assert.match(detail, /invalid_grant/);
  assert.doesNotMatch(detail, /private-oauth-token/);
  assert.equal(calls, 1);
});
test("only authenticated native requests can use the fixed Responses routes", async (t) => {
  let calls = 0,
    checks = 0;
  const gateway = await fixture(t, {
    accessToken: async () => {
      checks++;
      return "private-oauth-token";
    },
    fetcher: async () => {
      calls++;
      return Response.json({ ok: true });
    },
  });
  for (const options of [
    { headers: { authorization: "Bearer wrong" } },
    { headers: { origin: "https://example.com" } },
  ]) {
    const response = await request(gateway, "responses", options);
    assert.equal(response.status, 401);
    await response.text();
  }
  for (const [route, options] of [
    ["models", {}],
    ["responses?url=https://example.com", {}],
    ["responses", { method: "PUT" }],
  ]) {
    const response = await request(gateway, route, options);
    assert.equal(response.status, 404);
    await response.text();
  }
  assert.equal(calls, 0);
  assert.equal(checks, 0);
});
test("client cancellation aborts upstream streaming and gateway shutdown stops outstanding inference", async (t) => {
  const signals = [];
  let cancelled = 0;
  const gateway = await fixture(t, {
    accessToken: async () => "fixture-credential",
    fetcher: async (_url, options) => {
      signals.push(options.signal);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              Buffer.from("event: response.created\ndata: {}\n\n"),
            );
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const response = await request(gateway);
  await response.body.cancel();
  await waitFor(() => signals[0].aborted && cancelled === 1);
  const running = await request(gateway);
  await gateway.close();
  assert.ok(signals[1].aborted);
  await running.body.cancel().catch(() => {});
  await waitFor(() => cancelled === 2);
});
test("gateway shutdown waits for credential renewal to settle before an account can be replaced", async (t) => {
  let finishRenewal,
    started = false,
    stopped = false,
    calls = 0;
  const renewal = new Promise((resolve) => {
    finishRenewal = resolve;
  });
  const gateway = await fixture(t, {
    accessToken: async () => {
      started = true;
      await renewal;
      return "renewed-fixture-token";
    },
    fetcher: async () => {
      calls++;
      return Response.json({ ok: true });
    },
  });
  const pending = request(gateway).catch(() => null);
  await waitFor(() => started);
  const closing = gateway.close().then(() => {
    stopped = true;
  });
  await pending;
  assert.equal(stopped, false);
  finishRenewal();
  await closing;
  assert.equal(stopped, true);
  assert.equal(calls, 0);
});
