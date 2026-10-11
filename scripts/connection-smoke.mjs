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
    let admissionFailures = 0;
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      if (admissionFailures > 0) {
        admissionFailures--;
        response.writeHead(503, {
          "content-type": "application/json",
          "x-request-id": "req-electron-admission",
        });
        response.end(
          JSON.stringify({
            error: { code: "subscription_sharing_user_unavailable" },
          }),
        );
        return;
      }
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
      admissionFailures = 1;
      const admitted = await request();
      await admitted.text();
      const admissionRecoveryCalls = calls - recoveredCalls;
      const beforeAdmissionFailure = calls;
      admissionFailures = 10;
      const admission = await request();
      const admissionBody = await admission.json();
      const admissionError = gateway.takeError();
      const admissionCalls = calls - beforeAdmissionFailure;
      const beforeTransportFailure = calls;
      fail = true;
      const rejected = await request();
      return {
        recoveredStatus: recovered.status,
        recoveredBody,
        recoveredCalls,
        admissionRecoveryStatus: admitted.status,
        admissionRecoveryCalls,
        admissionStatus: admission.status,
        admissionBody,
        admissionError: {
          code: admissionError?.code,
          requestId: admissionError?.requestId,
        },
        admissionCalls,
        failedStatus: rejected.status,
        failedBody: await rejected.json(),
        failedCalls: calls - beforeTransportFailure,
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
  assert.equal(result.admissionRecoveryStatus, 200);
  assert.equal(result.admissionRecoveryCalls, 2);
  assert.equal(result.admissionStatus, 503);
  assert.equal(result.admissionCalls, 3);
  assert.equal(
    result.admissionBody.error.code,
    "subscription_sharing_user_unavailable",
  );
  assert.equal(
    result.admissionError.code,
    "subscription_sharing_user_unavailable",
  );
  assert.equal(result.admissionError.requestId, "req-electron-admission");
  assert.equal(result.failedStatus, 502);
  assert.equal(result.failedCalls, 3);
  assert.equal(result.failedBody.error.networkCode, "ERR_CONNECTION_REFUSED");
  assert.ok(result.codes.every((code) => code === "ERR_CONNECTION_REFUSED"));
  return "Electron connection passed: transport and HTTP 503 failures recover before streaming, retries stop at the limit, and safe diagnostics reach the caller.";
});
