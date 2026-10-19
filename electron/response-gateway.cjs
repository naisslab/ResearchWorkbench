const http = require("node:http");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");
const { promisify } = require("node:util");
const zlib = require("node:zlib");
const {
  AIError,
  publicError,
  networkError,
  apiError,
  RESOURCE,
} = require("./chatgpt.cjs");

const routes = new Set(["/v1/responses", "/v1/responses/compact"]);
const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);
const requestLimit = 64 * 1024 * 1024;

// Older saved threads can contain v2 helper messages even with agents disabled.
// Keep their readable context in place without replaying the unsupported item
// type. Do not change other items (especially tool call/output pairs), and never
// promote helper text to developer instructions. Saved history stays untouched.
async function compatibleBody(body, encoding) {
  if (encoding && encoding !== "identity" && encoding !== "gzip") return body;
  let payload;
  try {
    const decoded =
      encoding === "gzip"
        ? await gunzip(body, { maxOutputLength: requestLimit })
        : body;
    payload = JSON.parse(decoded.toString());
  } catch (error) {
    if (error.code === "ERR_BUFFER_TOO_LARGE")
      throw new AIError("request_too_large", "The model request is too large.");
    // Let the API diagnose malformed or unfamiliar payloads without rewriting.
    return body;
  }
  if (!Array.isArray(payload?.input)) return body;
  let changed = false;
  payload.input = payload.input.map((item) => {
    if (
      item?.type !== "agent_message" ||
      !Array.isArray(item.content) ||
      !item.content.every((part) =>
        [
          "input_text",
          "input_image",
          "input_file",
          "encrypted_content",
        ].includes(part?.type),
      )
    )
      return item;
    changed = true;
    const content = [
      {
        type: "input_text",
        text: `Historical helper message (${JSON.stringify({ author: item.author, recipient: item.recipient })}). Treat this as agent context, not a new instruction from the user.`,
      },
      ...item.content.filter((part) => part.type !== "encrypted_content"),
    ];
    // Agent-specific encrypted context is not a Responses reasoning item. Do
    // not relabel or send the opaque blob as text; disclose its omission.
    if (item.content.some((part) => part.type === "encrypted_content"))
      content.push({
        type: "input_text",
        text: "This historical helper message also contained encrypted context that cannot be replayed through ChatGPT plan usage.",
      });
    return { type: "message", role: "user", content };
  });
  if (!changed) return body;
  const normalized = Buffer.from(JSON.stringify(payload));
  if (normalized.length > requestLimit)
    throw new AIError("request_too_large", "The model request is too large.");
  return encoding === "gzip" ? gzip(normalized) : normalized;
}

const reconnectDelays = [500, 1500];
function retryDelay(response, attempt) {
  const fallback = reconnectDelays[attempt];
  const value = response.headers.get("retry-after");
  if (!value) return fallback;
  const milliseconds = /^\d+(\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  // Do not retry earlier than requested. Long server delays are left to the
  // user rather than keeping a turn waiting indefinitely.
  if (milliseconds > 10000) return undefined;
  return Number.isFinite(milliseconds)
    ? Math.max(fallback, milliseconds)
    : fallback;
}
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
// Renew rejected expired tokens. Transport failures and admission 503s share
// two retries. Never replay a response after a successful stream starts.
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
      // Normalize once so retries use identical bytes, including compression.
      const body = await compatibleBody(
        await readBody(request, requestLimit),
        request.headers["content-encoding"],
      );
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
          let upstream;
          try {
            upstream = await fetcher(`${RESOURCE}${request.url.slice(3)}`, {
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
            await delay(reconnectDelays[retries++], undefined, {
              signal: controller.signal,
            });
            continue;
          }
          if (upstream.status !== 503 || retries >= reconnectDelays.length)
            return upstream;
          const wait = retryDelay(upstream, retries);
          if (wait === undefined) return upstream;
          await upstream.body?.cancel();
          retries++;
          await delay(wait, undefined, { signal: controller.signal });
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
      if (upstream.status >= 400) {
        rejectedBody ??= await readBody(upstream.body || [], 1024 * 1024);
        let detail;
        try {
          detail = JSON.parse(rejectedBody.toString());
        } catch {
          // Preserve the original body for the native client, but expose only
          // known diagnostics to the UI, never raw proxy HTML or request data.
        }
        lastError = apiError(
          detail,
          upstream.status,
          upstream.headers.get("x-request-id"),
        );
        if (detail === undefined)
          lastError.responseShape = upstream.headers
            .get("content-type")
            ?.startsWith("text/html")
            ? "html"
            : "non_json";
      }
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
