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
  assert.equal(calls[1].headers.has("sec-fetch-mode"), false);
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

test("temporary transport failures retry the same request before streaming, without renewing credentials", async (t) => {
  const attempts = [];
  let checks = 0;
  const gateway = await fixture(t, {
    accessToken: async () => {
      checks++;
      return "fixture-credential";
    },
    fetcher: async (_url, options) => {
      attempts.push({
        body: Buffer.from(options.body),
        headers: new Headers(options.headers),
      });
      if (attempts.length < 3) throw new Error("net::ERR_CONNECTION_RESET");
      return Response.json({ recovered: true });
    },
  });
  const response = await request(gateway);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recovered: true });
  assert.equal(checks, 1);
  assert.equal(attempts.length, 3);
  for (const attempt of attempts) {
    assert.deepEqual(attempt.body, attempts[0].body);
    assert.deepEqual([...attempt.headers], [...attempts[0].headers]);
  }
  assert.equal(gateway.takeError(), undefined);
});

test("persistent proxy failures stop after two retries and expose only a safe diagnostic", async (t) => {
  let calls = 0;
  const gateway = await fixture(t, {
    accessToken: async () => "private-oauth-token",
    fetcher: async () => {
      calls++;
      throw new Error(
        "net::ERR_PROXY_CONNECTION_FAILED at https://secret.test/?token=private-oauth-token",
      );
    },
  });
  const response = await request(gateway);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(calls, 3);
  assert.equal(body.error.networkCode, "ERR_PROXY_CONNECTION_FAILED");
  assert.match(body.error.message, /proxy or VPN/);
  assert.doesNotMatch(JSON.stringify(body), /private-oauth-token|secret.test/);
  assert.equal(gateway.takeError().networkCode, "ERR_PROXY_CONNECTION_FAILED");
  assert.equal(gateway.takeError(), undefined);
});

test("certificate and unknown errors do not retry, and exhausted HTTP failures retain their response", async (t) => {
  for (const failure of [
    new Error("net::ERR_CERT_AUTHORITY_INVALID"),
    new Error("net::ERR_INVALID_ARGUMENT"),
    new TypeError("private payload"),
  ]) {
    let calls = 0;
    const gateway = await fixture(t, {
      accessToken: async () => "fixture",
      fetcher: async () => {
        calls++;
        throw failure;
      },
    });
    const response = await request(gateway);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private payload/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const gateway = await fixture(t, {
    accessToken: async () => "fixture",
    fetcher: async () => {
      calls++;
      return new Response("Unavailable", { status: 503 });
    },
  });
  const response = await request(gateway);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "Unavailable");
  assert.equal(calls, 3);
  assert.equal(gateway.takeError().status, 503);
});

test("cancelling during reconnect backoff prevents another upstream request", async (t) => {
  let calls = 0,
    signal;
  const gateway = await fixture(t, {
    accessToken: async () => "fixture",
    fetcher: async (_url, options) => {
      calls++;
      signal = options.signal;
      throw new Error("net::ERR_NETWORK_CHANGED");
    },
  });
  const controller = new AbortController();
  const pending = request(gateway, "responses", {
    signal: controller.signal,
  }).catch(() => null);
  await waitFor(() => calls === 1);
  controller.abort();
  await pending;
  await waitFor(() => signal.aborted);
  await gateway.close();
  assert.equal(calls, 1);
});

test("a transport failure after streaming starts never replays the model request", async (t) => {
  let calls = 0,
    stream;
  const gateway = await fixture(t, {
    accessToken: async () => "fixture",
    fetcher: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
            controller.enqueue(
              Buffer.from("event: response.created\ndata: {}\n\n"),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const response = await request(gateway);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  stream.error(new Error("net::ERR_CONNECTION_RESET"));
  await assert.rejects(reader.read());
  await gateway.close();
  assert.equal(calls, 1);
});

test("admission 503 retries preserve request bytes and credentials, then stream successfully", async (t) => {
  const attempts = [];
  let credentials = 0,
    cancelled = 0;
  const gateway = await fixture(t, {
    accessToken: async () => {
      credentials++;
      return "fixture-credential";
    },
    fetcher: async (_url, options) => {
      attempts.push({
        body: Buffer.from(options.body),
        authorization: options.headers.get("authorization"),
      });
      if (attempts.length < 3)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                Buffer.from('{"detail":"temporarily unavailable"}'),
              );
            },
            cancel() {
              cancelled++;
            },
          }),
          { status: 503, headers: { "retry-after": "0" } },
        );
      return new Response("event: response.completed\ndata: {}\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const response = await request(gateway);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /response.completed/);
  assert.equal(credentials, 1);
  assert.equal(cancelled, 2);
  assert.equal(attempts.length, 3);
  for (const attempt of attempts) assert.deepEqual(attempt, attempts[0]);
  assert.equal(gateway.takeError(), undefined);
});

test("persistent structured 503 retains upstream status, code and request ID without publishing private details", async (t) => {
  let calls = 0;
  const body = {
    error: {
      code: "subscription_sharing_user_unavailable",
      message: "private account details",
    },
  };
  const gateway = await fixture(t, {
    accessToken: async () => "fixture",
    fetcher: async () => {
      calls++;
      return Response.json(body, {
        status: 503,
        headers: { "x-request-id": `req-${calls}`, "cf-ray": "fixture-LAX" },
      });
    },
  });
  const response = await request(gateway);
  assert.equal(calls, 3);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cf-ray"), "fixture-LAX");
  assert.deepEqual(await response.json(), body);
  const error = gateway.takeError();
  assert.equal(error.code, body.error.code);
  assert.equal(error.status, 503);
  assert.equal(error.requestId, "req-3");
  assert.equal(error.responseShape, "error");
  assert.doesNotMatch(error.message, /127\.0\.0\.1|private account|Reconnect/);
});

test("long Retry-After stops automatic retries for detail and HTML admission failures", async (t) => {
  for (const retryAfter of [
    "120",
    new Date(Date.now() + 120000).toUTCString(),
  ]) {
    for (const [body, contentType, shape] of [
      [
        '{"detail":"private routing information"}',
        "application/json",
        "detail",
      ],
      ["<html>private routing information</html>", "text/html", "html"],
    ]) {
      let calls = 0;
      const gateway = await fixture(t, {
        accessToken: async () => "fixture",
        fetcher: async () => {
          calls++;
          return new Response(body, {
            status: 503,
            headers: {
              "retry-after": retryAfter,
              "content-type": contentType,
              "x-request-id": "req-admission",
            },
          });
        },
      });
      const response = await request(gateway);
      assert.equal(calls, 1);
      assert.equal(await response.text(), body);
      assert.equal(response.headers.get("retry-after"), retryAfter);
      const error = gateway.takeError();
      assert.equal(error.code, "http_503");
      assert.equal(error.requestId, "req-admission");
      assert.equal(error.responseShape, shape);
      assert.doesNotMatch(error.message, /private routing/);
    }
  }
});

test("transport failures and HTTP 503s share a bounded retry budget", async (t) => {
  let calls = 0;
  const gateway = await fixture(t, {
    accessToken: async () => "fixture",
    fetcher: async () => {
      if (++calls === 1) throw new Error("net::ERR_CONNECTION_RESET");
      return Response.json(
        { error: { code: "subscription_sharing_usage_unavailable" } },
        { status: 503 },
      );
    },
  });
  const response = await request(gateway);
  assert.equal(response.status, 503);
  await response.text();
  assert.equal(calls, 3);
  assert.equal(
    gateway.takeError().code,
    "subscription_sharing_usage_unavailable",
  );
});

test("cancelling an HTTP 503 backoff prevents replay", async (t) => {
  let calls = 0,
    signal;
  const gateway = await fixture(t, {
    accessToken: async () => "fixture",
    fetcher: async (_url, options) => {
      calls++;
      signal = options.signal;
      return new Response("Unavailable", {
        status: 503,
        headers: { "retry-after": "5" },
      });
    },
  });
  const controller = new AbortController();
  const pending = request(gateway, "responses", {
    signal: controller.signal,
  }).catch(() => null);
  await waitFor(() => calls === 1);
  controller.abort();
  await pending;
  await waitFor(() => signal.aborted);
  await gateway.close();
  assert.equal(calls, 1);
});

test("saved helper messages are replayed as context on both Responses routes without changing other input", async (t) => {
  const original = {
    model: "gpt-6-astra",
    stream: true,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Continue the paper" }],
      },
      {
        type: "reasoning",
        summary: [],
        encrypted_content: "original-reasoning",
      },
      {
        type: "custom_tool_call",
        call_id: "exec-1",
        name: "exec",
        input: "text('done');",
      },
      { type: "custom_tool_call_output", call_id: "exec-1", output: "done" },
      {
        type: "agent_message",
        id: "amsg_old",
        author: "/root/helper",
        recipient: "/root",
        content: [
          { type: "input_text", text: "Found the prior related work." },
          { type: "input_image", image_url: "data:image/png;base64,fixture" },
          {
            type: "encrypted_content",
            encrypted_content: "opaque-agent-context",
          },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Keep all citations" }],
      },
    ],
    tools: [{ type: "custom", name: "exec" }],
  };
  for (const route of ["responses", "responses/compact"]) {
    for (const compressed of [false, true]) {
      let calls = 0,
        forwarded;
      const gateway = await fixture(t, {
        accessToken: async ({ rejectedToken } = {}) =>
          rejectedToken ? "renewed" : "old",
        fetcher: async (_url, options) => {
          const data =
            options.headers.get("content-encoding") === "gzip"
              ? zlib.gunzipSync(options.body)
              : options.body;
          const body = JSON.parse(data.toString());
          calls++;
          assert.ok(!body.input.some((item) => item.type === "agent_message"));
          assert.deepEqual(body.input.slice(0, 4), original.input.slice(0, 4));
          assert.deepEqual(body.input[5], original.input[5]);
          assert.deepEqual(body.tools, original.tools);
          const restored = body.input[4];
          assert.equal(restored.type, "message");
          assert.equal(restored.role, "user");
          assert.equal(restored.id, undefined);
          assert.match(restored.content[0].text, /historical.*helper/i);
          assert.match(restored.content[0].text, /\/root\/helper/);
          assert.deepEqual(
            restored.content.slice(1, 3),
            original.input[4].content.slice(0, 2),
          );
          assert.doesNotMatch(JSON.stringify(body), /opaque-agent-context/);
          assert.match(JSON.stringify(restored), /encrypted context/i);
          if (calls === 1) {
            forwarded = Buffer.from(options.body);
            return Response.json(
              { error: { code: "token_expired" } },
              { status: 401 },
            );
          }
          assert.deepEqual(
            options.body,
            forwarded,
            "Token renewal reuses the normalized request",
          );
          return Response.json({ output: [] });
        },
      });
      const json = Buffer.from(JSON.stringify(original));
      const response = await request(gateway, route, {
        body: compressed ? zlib.gzipSync(json) : json,
        headers: compressed ? { "content-encoding": "gzip" } : {},
      });
      assert.equal(response.status, 200);
      await response.json();
      assert.equal(calls, 2);
    }
  }
});

test("unsupported input errors expose safe diagnostics without retries or token refresh", async (t) => {
  let calls = 0,
    refreshes = 0;
  const error = {
    code: "subscription_sharing_unsupported_capability",
    param: "input",
    message: "private upstream request details",
  };
  const gateway = await fixture(t, {
    accessToken: async ({ rejectedToken } = {}) => {
      if (rejectedToken) refreshes++;
      return "fixture";
    },
    fetcher: async () => {
      calls++;
      return Response.json(
        { error },
        { status: 400, headers: { "x-request-id": "req-input" } },
      );
    },
  });
  const response = await request(gateway);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error });
  const detail = gateway.takeError();
  assert.equal(detail.code, error.code);
  assert.equal(detail.param, "input");
  assert.equal(detail.requestId, "req-input");
  assert.doesNotMatch(detail.message, /private upstream/);
  assert.equal(calls, 1);
  assert.equal(refreshes, 0);
});
