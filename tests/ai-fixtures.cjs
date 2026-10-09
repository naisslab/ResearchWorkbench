const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createChatGPT } = require("../electron/chatgpt.cjs");

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "research-ai-"));
  const cleanup = [];
  t.after(async () => {
    for (const stop of cleanup) await stop();
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });
  const key = crypto.randomBytes(32);
  const encryption = {
    isAvailable: () => true,
    encrypt: (text) => {
      const nonce = crypto.randomBytes(12),
        cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    decrypt: (bytes) => {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString();
    },
  };
  const { SignJWT } = await import("jose");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "fixture-key";
  const control = {
    scopes:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    nonce: "",
    subject: "person-1",
    email: "researcher@example.test",
    client: 0,
    refreshes: 0,
    expire: false,
    invalidNonce: false,
    refreshError: null,
    jwksUnavailable: false,
    revocation: 200,
    authorization: null,
  };
  const urls = [],
    requests = [];
  const fetcher = async (url, options = {}) => {
    urls.push(String(url));
    if (String(url).endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: "https://auth.openai.com",
        authorization_endpoint:
          "https://auth.openai.com/api/accounts/authorize",
        token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
        jwks_uri: "https://auth.openai.com/jwks",
        revocation_endpoint: "https://auth.openai.com/revoke",
      });
    if (String(url).endsWith("/jwks"))
      return control.jwksUnavailable
        ? Response.json({}, { status: 503 })
        : Response.json({ keys: [jwk] });
    if (String(url).endsWith("/revoke"))
      return new Response(null, { status: control.revocation });
    if (String(url).endsWith("/oauth/token")) {
      const body = new URLSearchParams(options.body);
      requests.push(body);
      if (body.get("grant_type") === "refresh_token") {
        control.refreshes++;
        if (control.refreshError)
          return Response.json(
            { error: control.refreshError },
            { status: 400 },
          );
      }
      const idToken = await new SignJWT({
        sub: control.subject,
        email: control.email,
        nonce: control.invalidNonce ? "wrong-nonce" : control.nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
        .setIssuer("https://auth.openai.com")
        .setAudience(body.get("client_id"))
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      return Response.json({
        scope: control.scopes,
        access_token: `fixture-access-${control.client}-${control.refreshes}`,
        refresh_token: `fixture-refresh-${control.refreshes}`,
        id_token: idToken,
        token_type: "Bearer",
        expires_in:
          control.expire && body.get("grant_type") === "authorization_code"
            ? 1
            : 3600,
      });
    }
    if (String(url).endsWith("/models"))
      return Response.json({
        models: [
          {
            slug: "fixture-model",
            display_name: "Fixture Model",
            visibility: "list",
          },
          {
            slug: "hidden-model",
            display_name: "Hidden",
            visibility: "hidden",
          },
          {
            slug: "fixture-model-2",
            display_name: "Fixture Model 2",
            visibility: "list",
          },
        ],
      });
    throw new Error("Unexpected network request");
  };
  const openBrowser = async (value) => {
    const url = new URL(value);
    control.authorization = url;
    if (url.origin === "https://chatgpt.com") return;
    control.nonce = url.searchParams.get("nonce");
    const client = url.searchParams.get("client_id");
    const callback = new URL(url.searchParams.get("redirect_uri"));
    callback.searchParams.set("state", url.searchParams.get("state"));
    callback.searchParams.set("code", "fixture-code");
    if (client === "dynamic_agent_client")
      callback.searchParams.set(
        "client_id",
        `fixture-client-${++control.client}`,
      );
    const invalid = new URL(callback);
    invalid.searchParams.set("state", "unrelated-loopback-request");
    const invalidResponse = await fetch(invalid, { redirect: "manual" });
    if (invalidResponse.status !== 400)
      throw new Error("Invalid state consumed the callback");
    await invalidResponse.body.cancel();
    const response = await fetch(callback);
    await response.text();
  };
  return {
    cleanup: (stop) => cleanup.push(stop),
    directory,
    encryption,
    fetcher,
    openBrowser,
    control,
    urls,
    requests,
    auth: (onChange = () => {}) =>
      createChatGPT({ directory, encryption, fetcher, openBrowser, onChange }),
  };
}
async function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for fixture state");
}
async function signIn(client, options) {
  await (client.signIn ? client.signIn(options) : client.beginSignIn(options));
  return waitFor(async () => {
    const state = await (client.getState
      ? client.getState()
      : client.getSession());
    return state.status !== "connecting" ? state : false;
  });
}
module.exports = { fixture, waitFor, signIn };
