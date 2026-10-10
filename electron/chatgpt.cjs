const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { atomicWrite } = require("./core.cjs");

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const USAGE_URL = "https://chatgpt.com/settings/usage";
const terminalRefreshErrors = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalid",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
class AIError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}
function publicError(error) {
  if (!(error instanceof AIError))
    return {
      code: "connection_error",
      message:
        "The AI connection could not complete this operation. Try again.",
    };
  return Object.fromEntries(
    ["code", "message", "status", "requestId", "param", "responseShape"]
      .filter(
        (key) =>
          typeof error[key] === "string" || typeof error[key] === "number",
      )
      .map((key) => [key, error[key]]),
  );
}
function apiError(body, status, requestId) {
  const detail =
    body?.error && typeof body.error === "object" ? body.error : body;
  const rawCode = typeof body?.error === "string" ? body.error : detail?.code;
  const code =
    typeof rawCode === "string" && /^[a-zA-Z0-9_:-]{1,120}$/.test(rawCode)
      ? rawCode
      : `http_${status || "error"}`;
  const messages = {
    subscription_sharing_user_not_eligible:
      "ChatGPT plan usage is unavailable for this account or workspace.",
    subscription_sharing_usage_limit_exceeded:
      "The usage limit for this app has been reached. Open ChatGPT Usage to review your limits.",
    subscription_sharing_usage_unavailable:
      "ChatGPT could not check usage availability. Try again later.",
    subscription_sharing_unsupported_capability:
      "This model or capability is unavailable through ChatGPT plan usage. Choose another model.",
    subscription_sharing_route_not_supported:
      "ChatGPT plan usage does not support this request route.",
    subscription_sharing_invalid_user:
      "ChatGPT could not validate this connection. Reconnect your account.",
    subscription_sharing_user_unavailable:
      "Your ChatGPT account is temporarily unavailable. Try again later.",
    chatpass_v2_scope_not_authorized:
      "ChatGPT did not authorize plan usage for this connection. Enable it in your account controls.",
    chatpass_v2_invalid_authorization_context:
      "The ChatGPT authorization could not be accepted. Reconnect your account.",
    access_denied:
      "ChatGPT sign-in was declined. You can try again when you are ready.",
    invalid_grant:
      "Your ChatGPT connection has expired. Reconnect your account.",
    invalid_client:
      "ChatGPT did not accept this app registration. Reconnect or add a new account.",
  };
  const fallback =
    status === 401
      ? "ChatGPT did not accept this connection. Reconnect your account."
      : status === 403
        ? "Your account, workspace, or region does not permit this request."
        : status === 429
          ? "ChatGPT has reached a usage limit. Open ChatGPT Usage before trying again."
          : status >= 500
            ? "ChatGPT is temporarily unavailable. Try again later."
            : "ChatGPT could not complete this request. Try again or select another model.";
  return new AIError(code, messages[code] || fallback, {
    status,
    requestId:
      typeof requestId === "string" ? requestId.slice(0, 200) : undefined,
    param:
      typeof detail?.param === "string"
        ? detail.param.slice(0, 100)
        : undefined,
    responseShape:
      body?.detail !== undefined
        ? "detail"
        : body?.error !== undefined
          ? "error"
          : "other",
  });
}
const protectedWrite = (file, contents) =>
  atomicWrite(file, contents, {
    directoryMode: 0o700,
    flag: "wx",
    mode: 0o600,
  });
async function remote(fetcher, url, options = {}, timeout = 20000) {
  try {
    return await fetcher(url, {
      ...options,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.any([
        options.signal || new AbortController().signal,
        AbortSignal.timeout(timeout),
      ]),
    });
  } catch {
    if (options.signal?.aborted)
      throw new AIError("cancelled", "The operation was cancelled.");
    throw new AIError(
      "network_error",
      "Could not reach ChatGPT. Check your connection and try again.",
    );
  }
}
async function jsonResponse(response, stage = "ChatGPT request") {
  try {
    return await response.json();
  } catch {
    throw new AIError(
      "non_json_response",
      `${stage} failed (HTTP ${response.status}): the server returned ${response.headers.get("content-type")?.split(";")[0] === "text/html" ? "an HTML page" : "an unreadable response"}. Check your connection or system proxy and try again.`,
      {
        status: response.status,
        requestId: response.headers.get("x-request-id")?.slice(0, 200),
        responseShape:
          response.headers.get("content-type")?.split(";")[0] === "text/html"
            ? "html"
            : "non_json",
      },
    );
  }
}

function createChatGPT({
  directory,
  encryption,
  openBrowser,
  fetcher = fetch,
  onChange = () => {},
}) {
  let saved = { version: 1, profiles: [], activeProfileId: null };
  let hostId;
  let initialized;
  let discovery;
  let saveQueue = Promise.resolve();
  let pending;
  let lastError;
  const refreshing = new Map();
  const authFile = path.join(directory, "chatgpt-connections.enc");
  const active = () =>
    saved.profiles.find((p) => p.id === saved.activeProfileId);
  const sharing = (p) =>
    !!p?.credentials &&
    p.status === "connected" &&
    p.scopes.includes("chatgpt.tokens.use.direct");
  function snapshot() {
    const p = active();
    return {
      status: pending ? "connecting" : p?.status || "disconnected",
      sharing: sharing(p),
      activeProfileId: p?.id || null,
      profiles: saved.profiles.map((profile) => ({
        id: profile.id,
        label: profile.email || profile.name || "ChatGPT account",
        email: profile.email,
        name: profile.name,
        status: profile.status,
        sharing: sharing(profile),
      })),
      error: lastError,
    };
  }
  const changed = () => onChange(snapshot());
  async function initialize() {
    if (!initialized)
      initialized = (async () => {
        if (!encryption.isAvailable())
          throw new AIError(
            "secure_storage_unavailable",
            "Secure credential storage is unavailable. Unlock your system keychain and try again.",
          );
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        try {
          const data = JSON.parse(
            await fs.readFile(
              path.join(directory, "chatgpt-host.json"),
              "utf8",
            ),
          );
          if (!/^urn:uuid:[0-9a-f-]{36}$/.test(data.hostId))
            throw new Error("Invalid host");
          hostId = data.hostId;
        } catch (error) {
          if (error.code !== "ENOENT")
            throw new AIError(
              "storage_error",
              "The saved ChatGPT host could not be read. Its data has been preserved.",
            );
          hostId = `urn:uuid:${crypto.randomUUID()}`;
          await protectedWrite(
            path.join(directory, "chatgpt-host.json"),
            JSON.stringify({ hostId }),
          );
        }
        try {
          const data = JSON.parse(
            await encryption.decrypt(await fs.readFile(authFile)),
          );
          if (
            data.version !== 1 ||
            !Array.isArray(data.profiles) ||
            data.profiles.some(
              (p) => !p.id || !p.clientId || !Array.isArray(p.scopes),
            )
          )
            throw new Error("Invalid connection");
          saved = data;
        } catch (error) {
          if (error.code !== "ENOENT")
            throw new AIError(
              "storage_error",
              "The saved ChatGPT connection could not be decrypted. Its data has been preserved.",
            );
        }
      })().catch((error) => {
        initialized = undefined;
        throw error;
      });
    await initialized;
  }
  async function persist() {
    // Capture at enqueue time; serialize replacements so refreshes cannot overwrite newer data.
    const contents = JSON.stringify(saved);
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        if (!encryption.isAvailable())
          throw new AIError(
            "secure_storage_unavailable",
            "Secure credential storage is unavailable.",
          );
        await protectedWrite(authFile, await encryption.encrypt(contents));
      });
    await saveQueue;
  }
  async function config() {
    if (!discovery)
      discovery = (async () => {
        const response = await remote(
          fetcher,
          `${ISSUER}/.well-known/openid-configuration`,
        );
        const data = await jsonResponse(response, "ChatGPT sign-in setup");
        if (!response.ok || data.issuer !== ISSUER)
          throw new AIError(
            "discovery_failed",
            "ChatGPT sign-in configuration could not be verified.",
          );
        for (const key of [
          "authorization_endpoint",
          "token_endpoint",
          "jwks_uri",
          "revocation_endpoint",
        ]) {
          if (key === "revocation_endpoint" && !data[key]) continue;
          if (
            typeof data[key] !== "string" ||
            new URL(data[key]).origin !== ISSUER
          )
            throw new AIError(
              "discovery_failed",
              "ChatGPT sign-in configuration could not be verified.",
            );
        }
        return data;
      })().catch((error) => {
        discovery = undefined;
        throw error;
      });
    return discovery;
  }
  async function verifyIdentity(idToken, clientId, nonce, receivedAt) {
    const provider = await config();
    const response = await remote(fetcher, provider.jwks_uri);
    const keys = await jsonResponse(response, "ChatGPT identity verification");
    if (!response.ok || !Array.isArray(keys.keys))
      throw new AIError(
        "identity_unavailable",
        "ChatGPT identity verification is temporarily unavailable. Try again shortly.",
      );
    try {
      const { jwtVerify, createLocalJWKSet } = await import("jose");
      const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
        issuer: ISSUER,
        audience: clientId,
        algorithms: ["RS256"],
        clockTolerance: 5,
        requiredClaims: ["iss", "aud", "exp", "iat", "sub"],
        ...(receivedAt ? { currentDate: new Date(receivedAt) } : {}),
      });
      if (
        typeof payload.sub !== "string" ||
        !payload.sub ||
        !Number.isFinite(payload.iat) ||
        payload.iat > (receivedAt || Date.now()) / 1000 + 5 ||
        payload.exp <= payload.iat ||
        (nonce !== undefined && payload.nonce !== nonce) ||
        (payload.azp !== undefined && payload.azp !== clientId) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== clientId)
      )
        throw new Error("Identity mismatch");
      return {
        subject: payload.sub,
        email:
          typeof payload.email === "string"
            ? payload.email.slice(0, 200)
            : undefined,
        name:
          typeof payload.name === "string"
            ? payload.name.slice(0, 100)
            : undefined,
      };
    } catch {
      throw new AIError(
        "invalid_id_token",
        "The ChatGPT identity could not be verified. Reconnect your account.",
      );
    }
  }
  async function tokenRequest(body, signal) {
    const provider = await config();
    const response = await remote(fetcher, provider.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    const data = await jsonResponse(response, "ChatGPT authorization");
    if (!response.ok)
      throw apiError(
        data,
        response.status,
        response.headers.get("x-request-id"),
      );
    return data;
  }
  function tokenFields(data, oldScopes) {
    const scope = data.scope ?? oldScopes?.join(" ");
    if (typeof scope !== "string")
      throw new AIError(
        "invalid_token_response",
        "ChatGPT did not confirm the granted permissions.",
      );
    const scopes = scope.split(/\s+/).filter(Boolean);
    if (!scopes.includes("chatgpt.tokens.use.direct") && !data.access_token)
      return { scopes };
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.token_type !== "string" ||
      data.token_type.toLowerCase() !== "bearer" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 ||
      (scopes.includes("offline_access") &&
        (typeof data.refresh_token !== "string" || !data.refresh_token))
    )
      throw new AIError(
        "invalid_token_response",
        "ChatGPT returned incomplete credentials. Reconnect your account.",
      );
    return {
      scopes,
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      },
    };
  }
  async function beginSignIn({
    profileId,
    newProfile = false,
    reconsent = false,
  } = {}) {
    await initialize();
    if (pending)
      throw new AIError(
        "sign_in_running",
        "A ChatGPT sign-in is already open in your browser.",
      );
    const previous = newProfile
      ? undefined
      : saved.profiles.find(
          (p) => p.id === (profileId || saved.activeProfileId),
        );
    if (profileId && !previous && !newProfile)
      throw new AIError("invalid_profile", "Choose a saved ChatGPT account.");
    const controller = new AbortController();
    const attempt = {
      controller,
      previous,
      id: previous?.id || crypto.randomUUID(),
    };
    pending = attempt;
    lastError = undefined;
    changed();
    attempt.done = authorize(attempt, reconsent)
      .catch((error) => {
        if (error.code !== "cancelled") lastError = publicError(error);
      })
      .finally(() => {
        if (pending === attempt) pending = undefined;
        changed();
      });
    return snapshot();
  }
  async function authorize(attempt, reconsent) {
    const { previous, controller } = attempt;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(5 * 60 * 1000),
    ]);
    const provider = await config();
    signal.throwIfAborted();
    const state = crypto.randomBytes(32).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    let resolveCallback,
      rejectCallback,
      settled = false;
    const callback = new Promise((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    void callback.catch(() => {});
    const server = http.createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      if (req.method === "GET" && req.url === "/auth/complete") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Return to Research Workbench to finish connecting ChatGPT.");
        return;
      }
      const url = new URL(req.url || "/", attempt.redirectUri);
      if (
        req.method !== "GET" ||
        req.headers.host !== new URL(attempt.redirectUri).host ||
        url.pathname !== "/auth/callback" ||
        settled
      ) {
        res.writeHead(404).end();
        return;
      }
      const returnedState = Buffer.from(url.searchParams.get("state") || "");
      const expected = Buffer.from(state);
      if (
        url.searchParams.getAll("state").length !== 1 ||
        returnedState.length !== expected.length ||
        !crypto.timingSafeEqual(returnedState, expected)
      ) {
        res
          .writeHead(400)
          .end(
            "Invalid sign-in state. Return to the browser tab that started sign-in.",
          );
        return;
      }
      settled = true;
      res.writeHead(302, { Location: "/auth/complete" }).end();
      if (url.searchParams.has("error")) {
        rejectCallback(apiError({ error: url.searchParams.get("error") }));
        return;
      }
      const code = url.searchParams.get("code");
      const returnedId = url.searchParams.get("client_id");
      const clientId = returnedId || previous?.clientId;
      if (
        !code ||
        url.searchParams.getAll("code").length !== 1 ||
        url.searchParams.getAll("client_id").length > 1 ||
        !clientId ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) ||
        clientId === "dynamic_agent_client" ||
        (previous && returnedId && returnedId !== previous.clientId)
      )
        rejectCallback(
          new AIError(
            "registration_incomplete",
            "ChatGPT did not complete app registration. Try signing in again.",
          ),
        );
      else resolveCallback({ code, clientId });
    });
    server.requestTimeout = 15000;
    const abort = () => {
      rejectCallback(
        new AIError("cancelled", "ChatGPT sign-in was cancelled or timed out."),
      );
      server.closeAllConnections();
      server.close();
    };
    try {
      await new Promise((resolve, reject) => {
        const listenError = () =>
          reject(
            new AIError(
              "callback_unavailable",
              "Could not open the local sign-in listener. Check this app's local network permissions and try again.",
            ),
          );
        server.once("error", listenError);
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", listenError);
          resolve();
        });
      });
      server.on("error", () =>
        rejectCallback(
          new AIError(
            "callback_failed",
            "The local sign-in listener stopped. Try again.",
          ),
        ),
      );
      attempt.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
      signal.addEventListener("abort", abort, { once: true });
      signal.throwIfAborted();
      const url = new URL(provider.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: previous?.clientId || "dynamic_agent_client",
        ...(previous ? {} : { agent_name_hint: "Research Workbench" }),
        ext_agent_host_id: hostId,
        response_type: "code",
        redirect_uri: attempt.redirectUri,
        scope: SCOPES,
        resource: RESOURCE,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: crypto
          .createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        ...(previous?.email ? { login_hint: previous.email } : {}),
        ...(reconsent ? { prompt: "consent" } : {}),
      }).toString();
      await openBrowser(url.toString());
      const result = await callback;
      signal.throwIfAborted();
      let target = saved.profiles.find((p) => p.id === attempt.id);
      if (!target) {
        target = {
          id: attempt.id,
          clientId: result.clientId,
          status: "disconnected",
          scopes: [],
        };
        saved.profiles.push(target);
      }
      // Retain the issued registration even if the one-time code exchange fails.
      await persist();
      const data = await tokenRequest(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: result.clientId,
          code: result.code,
          code_verifier: verifier,
          redirect_uri: attempt.redirectUri,
          resource: RESOURCE,
        }),
        signal,
      );
      const identity = await verifyIdentity(
        data.id_token,
        result.clientId,
        nonce,
      );
      if (previous?.subject && identity.subject !== previous.subject)
        throw new AIError(
          "account_mismatch",
          "Choose the original ChatGPT account, or add a separate account.",
        );
      signal.throwIfAborted();
      Object.assign(target, identity, tokenFields(data), {
        status: "connected",
      });
      delete target.pendingRefresh;
      saved.activeProfileId = target.id;
      await persist();
    } finally {
      signal.removeEventListener("abort", abort);
      server.close();
      server.closeAllConnections();
    }
  }
  async function cancelSignIn() {
    pending?.controller.abort();
    await pending?.done;
    return snapshot();
  }
  async function getSession() {
    try {
      await initialize();
    } catch (error) {
      lastError = publicError(error);
    }
    return snapshot();
  }
  async function selectProfile(id) {
    await initialize();
    if (pending)
      throw new AIError(
        "sign_in_running",
        "Cancel the pending sign-in before switching accounts.",
      );
    if (!saved.profiles.some((p) => p.id === id))
      throw new AIError("invalid_profile", "Choose a saved ChatGPT account.");
    saved.activeProfileId = id;
    lastError = undefined;
    await persist();
    changed();
    return snapshot();
  }
  async function accessToken(profileId, { rejectedToken } = {}) {
    await initialize();
    const p = saved.profiles.find(
      (p) =>
        p.id === (profileId === undefined ? saved.activeProfileId : profileId),
    );
    if (!sharing(p))
      throw new AIError(
        "plan_usage_disabled",
        "Connect ChatGPT and enable ChatGPT plan usage to send a message.",
      );
    // A Responses request can report expiry before our local clock does.
    // Refresh only the rejected credential; concurrent requests may already
    // have replaced it using the same rotating refresh token.
    if (
      !refreshing.has(p.id) &&
      !p.pendingRefresh &&
      rejectedToken !== p.credentials.accessToken &&
      p.credentials.expiresAt > Date.now() + 60000
    )
      return p.credentials.accessToken;
    if (!refreshing.has(p.id))
      refreshing.set(
        p.id,
        (async () => {
          try {
            let rotation = p.pendingRefresh;
            if (!rotation) {
              const data = await tokenRequest(
                new URLSearchParams({
                  grant_type: "refresh_token",
                  client_id: p.clientId,
                  refresh_token: p.credentials.refreshToken || "",
                  resource: RESOURCE,
                }),
              );
              rotation = {
                ...tokenFields(data, p.scopes),
                idToken: data.id_token,
                receivedAt: Date.now(),
              };
              p.pendingRefresh = rotation;
              await persist();
            }
            if (rotation.idToken) {
              const identity = await verifyIdentity(
                rotation.idToken,
                p.clientId,
                undefined,
                rotation.receivedAt,
              );
              if (identity.subject !== p.subject)
                throw new AIError(
                  "account_mismatch",
                  "The refreshed account does not match this connection. Reconnect your account.",
                );
            }
            Object.assign(p, {
              credentials: rotation.credentials,
              scopes: rotation.scopes,
            });
            delete p.pendingRefresh;
            await persist();
            if (!sharing(p))
              throw new AIError(
                "plan_usage_disabled",
                "ChatGPT plan usage is no longer enabled for this account.",
              );
            lastError = undefined;
            changed();
            return p.credentials.accessToken;
          } catch (error) {
            if (terminalRefreshErrors.has(error.code)) {
              delete p.credentials;
              delete p.pendingRefresh;
              p.status = "reauth_required";
              await persist();
            }
            lastError = publicError(error);
            changed();
            throw error;
          }
        })().finally(() => refreshing.delete(p.id)),
      );
    return refreshing.get(p.id);
  }
  async function disconnect() {
    await initialize();
    await cancelSignIn();
    const p = active();
    if (!p) return snapshot();
    await refreshing.get(p.id)?.catch(() => {});
    const token =
      p.pendingRefresh?.credentials?.refreshToken ||
      p.credentials?.refreshToken;
    let confirmed = !token;
    if (token) {
      try {
        const provider = await config();
        if (provider.revocation_endpoint) {
          for (let attempt = 0; attempt < 2; attempt++) {
            const response = await remote(
              fetcher,
              provider.revocation_endpoint,
              {
                method: "POST",
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  token,
                  token_type_hint: "refresh_token",
                  client_id: p.clientId,
                }),
              },
              10000,
            );
            await response.body?.cancel();
            if (response.status === 200) {
              confirmed = true;
              break;
            }
            if (response.status < 500) break;
          }
        }
      } catch {
        /* Complete local sign-out, then report unconfirmed revocation. */
      }
    }
    delete p.credentials;
    delete p.pendingRefresh;
    p.status = "disconnected";
    lastError = confirmed
      ? undefined
      : publicError(
          new AIError(
            "revocation_unconfirmed",
            "Signed out locally. Remote disconnection was not confirmed; disconnect this app in ChatGPT settings.",
          ),
        );
    await persist();
    changed();
    return snapshot();
  }
  return {
    getSession,
    beginSignIn,
    cancelSignIn,
    selectProfile,
    accessToken,
    disconnect,
    dispose: () => pending?.controller.abort(),
  };
}

module.exports = {
  createChatGPT,
  AIError,
  publicError,
  apiError,
  protectedWrite,
  remote,
  jsonResponse,
  RESOURCE,
  USAGE_URL,
};
