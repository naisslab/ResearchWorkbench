import assert from "node:assert/strict";
import { launchApp, smoke } from "./smoke-harness.mjs";

await smoke("connection", async () => {
  const { app } = await launchApp();
  const result = await app.evaluate(async ({ app, net }) => {
    const requireApp = process
      .getBuiltinModule("node:module")
      .createRequire(app.getAppPath() + "/package.json");
    const { createResponseGateway } = requireApp(
      "./electron/response-gateway.cjs",
    );
    const http = process.getBuiltinModule("node:http");
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ body: Buffer.concat(chunks).toString() }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const reservation = http.createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const unavailable = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const codes = [];
    let calls = 0,
      fail = false;
    const gateway = await createResponseGateway({
      accessToken: async () => "isolated-fixture-token",
      fetcher: async (_url, options) => {
        calls++;
        try {
          return await net.fetch(
            `http://127.0.0.1:${fail || calls === 1 ? unavailable : server.address().port}/v1/responses`,
            options,
          );
        } catch (error) {
          codes.push(error.message.match(/net::(ERR_[A-Z_]+)/)?.[1]);
          throw error;
        }
      },
    });
    const request = () =>
      fetch(`${gateway.baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${gateway.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ input: "synthetic connection test" }),
      });
    try {
      const recovered = await request();
      const recoveredBody = await recovered.json();
      const recoveredCalls = calls;
      fail = true;
      const rejected = await request();
      return {
        recoveredStatus: recovered.status,
        recoveredBody,
        recoveredCalls,
        failedStatus: rejected.status,
        failedBody: await rejected.json(),
        failedCalls: calls - recoveredCalls,
        codes,
      };
    } finally {
      await gateway.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  assert.equal(result.recoveredStatus, 200, JSON.stringify(result));
  assert.equal(
    JSON.parse(result.recoveredBody.body).input,
    "synthetic connection test",
  );
  assert.equal(result.recoveredCalls, 2);
  assert.equal(result.failedStatus, 502);
  assert.equal(result.failedCalls, 3);
  assert.equal(result.failedBody.error.networkCode, "ERR_CONNECTION_REFUSED");
  assert.ok(result.codes.every((code) => code === "ERR_CONNECTION_REFUSED"));
  return "Electron connection passed: real Chromium transport errors recover before streaming, retries stop at the limit, and safe diagnostics reach the caller.";
});
