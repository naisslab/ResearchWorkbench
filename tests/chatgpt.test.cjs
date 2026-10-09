const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  createChatGPT,
  publicError,
  apiError,
  jsonResponse,
} = require("../electron/chatgpt.cjs");
const { fixture, signIn } = require("./ai-fixtures.cjs");

test("OAuth validates state and signed identity, stores encrypted credentials, and retains the host and registration", async (t) => {
  const f = await fixture(t),
    auth = f.auth();
  f.cleanup(() => auth.dispose());
  const signed = await signIn(auth);
  assert.equal(signed.status, "connected");
  assert.equal(signed.sharing, true);
  assert.equal(
    f.control.authorization.searchParams.get("agent_name_hint"),
    "Research Workbench",
  );
  assert.equal(
    new URL(f.control.authorization.searchParams.get("redirect_uri")).hostname,
    "127.0.0.1",
  );
  const host = f.control.authorization.searchParams.get("ext_agent_host_id");
  const file = path.join(f.directory, "chatgpt-connections.enc");
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal(
    (await fs.readFile(file)).includes(Buffer.from("fixture-access")),
    false,
  );
  assert.equal(JSON.stringify(signed).includes("fixture-access"), false);
  assert.equal(f.requests[0].get("client_id"), "fixture-client-1");
  assert.notEqual(f.requests[0].get("client_id"), "dynamic_agent_client");
  const again = f.auth();
  f.cleanup(() => again.dispose());
  const reopened = await again.getSession();
  assert.equal(reopened.activeProfileId, signed.activeProfileId);
  await signIn(again);
  assert.equal(
    f.control.authorization.searchParams.get("client_id"),
    "fixture-client-1",
  );
  assert.equal(
    f.control.authorization.searchParams.get("ext_agent_host_id"),
    host,
  );
  assert.equal(
    f.control.authorization.searchParams.has("agent_name_hint"),
    false,
  );
});
test("identity sign-in without plan permission cannot issue inference credentials", async (t) => {
  const f = await fixture(t);
  f.control.scopes = "openid profile email";
  const auth = f.auth();
  f.cleanup(() => auth.dispose());
  const state = await signIn(auth);
  assert.equal(state.status, "connected");
  assert.equal(state.sharing, false);
  await assert.rejects(auth.accessToken(), { code: "plan_usage_disabled" });
});
test("invalid OIDC nonce never activates a connection", async (t) => {
  const f = await fixture(t);
  f.control.invalidNonce = true;
  const auth = f.auth();
  f.cleanup(() => auth.dispose());
  const state = await signIn(auth);
  assert.equal(state.sharing, false);
  assert.equal(state.activeProfileId, null);
  assert.equal(state.error.code, "invalid_id_token");
});
test("token refresh is serialized and a rotating response survives a temporary JWKS outage", async (t) => {
  const f = await fixture(t);
  f.control.expire = true;
  const auth = f.auth();
  f.cleanup(() => auth.dispose());
  await signIn(auth);
  f.control.jwksUnavailable = true;
  const failures = await Promise.allSettled([
    auth.accessToken(),
    auth.accessToken(),
  ]);
  assert.ok(failures.every((result) => result.status === "rejected"));
  assert.equal(f.control.refreshes, 1);
  f.control.jwksUnavailable = false;
  const tokens = await Promise.all([auth.accessToken(), auth.accessToken()]);
  assert.equal(tokens[0], "fixture-access-1-1");
  assert.equal(tokens[1], tokens[0]);
  assert.equal(f.control.refreshes, 1);
});
test("terminal refresh failure requires reconnection; temporary errors preserve credentials", async (t) => {
  const f = await fixture(t);
  f.control.expire = true;
  const auth = f.auth();
  f.cleanup(() => auth.dispose());
  await signIn(auth);
  f.control.refreshError = "invalid_grant";
  await assert.rejects(auth.accessToken(), { code: "invalid_grant" });
  assert.equal((await auth.getSession()).status, "reauth_required");
  const stored = JSON.parse(
    f.encryption.decrypt(
      await fs.readFile(path.join(f.directory, "chatgpt-connections.enc")),
    ),
  );
  assert.equal(stored.profiles[0].credentials, undefined);
  assert.equal(stored.profiles[0].clientId, "fixture-client-1");
});
test("registrations remain distinct even with the same email and subject", async (t) => {
  const f = await fixture(t),
    auth = f.auth();
  f.cleanup(() => auth.dispose());
  const first = await signIn(auth);
  const second = await signIn(auth, { newProfile: true });
  assert.equal(second.profiles.length, 2);
  assert.notEqual(first.activeProfileId, second.activeProfileId);
  await auth.selectProfile(first.activeProfileId);
  assert.equal(
    (await auth.getSession()).activeProfileId,
    first.activeProfileId,
  );
  f.control.revocation = 503;
  const out = await auth.disconnect();
  assert.equal(out.sharing, false);
  assert.equal(out.error.code, "revocation_unconfirmed");
  assert.equal(out.profiles.length, 2);
});
test("upstream diagnostics retain status, shape and request ID without exposing response bodies", () => {
  const error = publicError(
    apiError({ detail: "sensitive request body" }, 403, "req-test"),
  );
  assert.equal(error.status, 403);
  assert.equal(error.requestId, "req-test");
  assert.equal(error.responseShape, "detail");
  assert.equal(JSON.stringify(error).includes("sensitive request body"), false);
  assert.match(
    publicError(
      apiError(
        { error: { code: "subscription_sharing_usage_limit_exceeded" } },
        429,
      ),
    ).message,
    /Usage/,
  );
});

test("an HTML login rejection preserves HTTP diagnostics without exposing its body", async () => {
  const response = new Response("<html>private upstream details</html>", {
    status: 403,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "x-request-id": "req-html",
    },
  });
  await assert.rejects(
    jsonResponse(response, "ChatGPT sign-in setup"),
    (error) => {
      const detail = publicError(error);
      assert.equal(detail.code, "non_json_response");
      assert.equal(detail.status, 403);
      assert.equal(detail.responseShape, "html");
      assert.equal(detail.requestId, "req-html");
      assert.match(detail.message, /sign-in setup.*HTTP 403.*HTML/);
      assert.doesNotMatch(detail.message, /private upstream/);
      return true;
    },
  );
});

test("a blocked discovery attempt never opens authorization and can be retried", async (t) => {
  const f = await fixture(t);
  let blocked = true,
    opens = 0;
  const auth = createChatGPT({
    ...f,
    fetcher: (url, options) =>
      blocked && String(url).endsWith("/.well-known/openid-configuration")
        ? new Response("<html>blocked</html>", {
            status: 403,
            headers: { "content-type": "text/html" },
          })
        : f.fetcher(url, options),
    openBrowser: async (url) => {
      opens++;
      await f.openBrowser(url);
    },
  });
  f.cleanup(() => auth.dispose());
  const failure = await signIn(auth);
  assert.equal(failure.error.status, 403);
  assert.equal(failure.error.responseShape, "html");
  assert.equal(opens, 0);
  blocked = false;
  assert.equal((await signIn(auth)).sharing, true);
  assert.equal(opens, 1);
});
