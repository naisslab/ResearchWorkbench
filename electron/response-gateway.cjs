const http = require("node:http");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");
const {
  AIError,
  publicError,
  networkError,
  RESOURCE,
} = require("./chatgpt.cjs");

const routes = new Set(["/v1/responses", "/v1/responses/compact"]);
const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
async function readBody(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit)
      throw new AIError("request_too_large", "The model request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Codex's custom provider reads ACCESS_TOKEN once from its environment. Keep
// that process (and its active turn) alive by renewing OAuth at the HTTP boundary.
// Renew rejected expired tokens, and retry a transient transport failure at most
// twice before headers arrive. Never replay a response after streaming starts.
async function createResponseGateway({ accessToken, fetcher = fetch }) {
  const token = crypto.randomBytes(32).toString("hex");
  const authorization = Buffer.from(`Bearer ${token}`);
  const active = new Map();
  let closed = false,
    closing,
    lastError;
  const server = http.createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization || "");
    if (
      closed ||
      request.headers.origin ||
      supplied.length !== authorization.length ||
      !crypto.timingSafeEqual(supplied, authorization)
    ) {
      response.writeHead(401).end();
      request.resume();
      return;
    }
    if (request.method !== "POST" || !routes.has(request.url)) {
      response.writeHead(404).end();
      request.resume();
      return;
    }
    const controller = new AbortController();
    lastError = undefined;
    let finish;
    active.set(
      controller,
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const abort = () => controller.abort();
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      // Preserve compressed bytes as well as headers for an identical retry.
      const body = await readBody(request, 64 * 1024 * 1024);
      const headers = new Headers();
      const excluded = new Set([
        ...hopHeaders,
        ...(request.headers.connection || "").toLowerCase().split(/\s*,\s*/),
        "authorization",
        "host",
        "cookie",
        "content-length",
        "accept-encoding",
      ]);
      // Chromium generates fetch metadata itself. Re-forwarding the native
      // caller's browser metadata can make net.fetch fail with ERR_INVALID_ARGUMENT.
      for (const [name, value] of Object.entries(request.headers))
        if (
          !excluded.has(name) &&
          !name.startsWith("sec-fetch-") &&
          typeof value === "string"
        )
          headers.set(name, value);
      headers.set("accept-encoding", "identity");
      let credential = await accessToken();
      let retries = 0;
      const forward = async () => {
        for (;;) {
          controller.signal.throwIfAborted();
          headers.set("authorization", `Bearer ${credential}`);
          try {
            return await fetcher(`${RESOURCE}${request.url.slice(3)}`, {
              method: "POST",
              headers,
              body,
              redirect: "error",
              credentials: "omit",
              signal: controller.signal,
            });
          } catch (error) {
            controller.signal.throwIfAborted();
            const failure = networkError(error);
            if (!failure.retryable || retries >= 2) throw failure;
            await delay([500, 1500][retries++], undefined, {
              signal: controller.signal,
            });
          }
        }
      };
      let upstream = await forward();
      let rejectedBody;
      if (upstream.status === 401) {
        rejectedBody = await readBody(upstream.body || [], 1024 * 1024);
        let error;
        try {
          error = JSON.parse(rejectedBody.toString());
        } catch {
          // HTML/proxy failures and unrecognized 401s must not trigger renewal.
        }
        if (
          error?.error?.code === "token_expired" ||
          error?.code === "token_expired"
        ) {
          controller.signal.throwIfAborted();
          credential = await accessToken({ rejectedToken: credential });
          upstream = await forward();
          rejectedBody = undefined;
        }
      }
      controller.signal.throwIfAborted();
      const responseHeaders = {};
      for (const [name, value] of upstream.headers)
        if (
          !hopHeaders.has(name) &&
          !["content-length", "content-encoding"].includes(name)
        )
          responseHeaders[name] = value;
      response.writeHead(upstream.status, responseHeaders);
      if (rejectedBody) response.end(rejectedBody);
      else if (upstream.body)
        await pipeline(Readable.fromWeb(upstream.body), response, {
          signal: controller.signal,
        });
      else response.end();
    } catch (error) {
      if (!controller.signal.aborted)
        lastError = error instanceof AIError ? error : networkError(error);
      if (controller.signal.aborted || response.headersSent) response.destroy();
      else {
        const detail = publicError(lastError);
        const status =
          error.code === "request_too_large"
            ? 413
            : error.code === "network_error" || !(error instanceof AIError)
              ? 502
              : 401;
        response.writeHead(status, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify({ error: detail }));
      }
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
      active.delete(controller);
      finish();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  return {
    token,
    takeError: () => {
      const error = lastError;
      lastError = undefined;
      return error;
    },
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => {
      if (closing) return closing;
      closed = true;
      for (const controller of active.keys()) controller.abort();
      const stopped = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      // Renewal can rotate credentials even after the native request aborts.
      // Finish persisting it before sign-in/account changes or app shutdown.
      closing = Promise.allSettled([stopped, ...active.values()]);
      return closing;
    },
  };
}
module.exports = { createResponseGateway };
