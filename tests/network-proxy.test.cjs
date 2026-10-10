const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { proxyEnvironment } = require("../electron/network-proxy.cjs");
const {
  createGitRunner,
  createGitEnvironment,
} = require("../electron/git-runner.cjs");
const { withoutProxy } = require("./fixtures.cjs");

test("system proxy routes reach HTTP, HTTPS and SOCKS clients without overriding explicit preferences", async () => {
  for (const [route, expected] of [
    ["PROXY 127.0.0.1:12000; DIRECT", "http://127.0.0.1:12000"],
    ["HTTPS proxy.example.test:443", "https://proxy.example.test:443"],
    ["SOCKS5 127.0.0.1:1080", "socks5h://127.0.0.1:1080"],
  ]) {
    assert.deepEqual(
      await proxyEnvironment("https://github.com", {}, async () => route),
      { https_proxy: expected },
    );
  }
  const unexpected = async () => {
    throw new Error("Explicit preferences must skip system resolution");
  };
  for (const env of [
    { HTTPS_PROXY: "http://existing.test:80" },
    { https_proxy: "http://existing.test:80" },
    { ALL_PROXY: "socks5h://existing.test:1080" },
    { all_proxy: "socks5h://existing.test:1080" },
  ])
    assert.deepEqual(
      await proxyEnvironment("https://github.com", env, unexpected),
      {},
    );
  // Git and curl read only lowercase http_proxy, so the system route still applies.
  assert.deepEqual(
    await proxyEnvironment(
      "http://github.com",
      { HTTP_PROXY: "http://ignored.test:80" },
      async () => "PROXY 127.0.0.1:12000",
    ),
    { http_proxy: "http://127.0.0.1:12000" },
  );
  assert.deepEqual(
    await proxyEnvironment(
      "https://github.com",
      {},
      async () => "DIRECT; PROXY fallback.test:80",
    ),
    {},
  );
  assert.deepEqual(
    await proxyEnvironment("https://github.com", {}, async () => {
      throw new Error("Resolver unavailable");
    }),
    {},
  );
  for (const url of [
    "/tmp/paper.git",
    "git@github.com:example/paper.git",
    "file:///tmp/paper.git",
    "git://localhost/paper.git",
  ])
    assert.deepEqual(await proxyEnvironment(url, {}, unexpected), {});
});

test("agent inherits system proxy settings and keeps its existing bypass and Git preferences", async () => {
  const input = {
    PATH: "/usr/bin:/bin",
    NO_PROXY: "localhost,127.0.0.1",
    GIT_CONFIG_PARAMETERS: "'research.fixture=preserved'",
  };
  const result = await createGitEnvironment(
    input,
    async () => "PROXY 127.0.0.1:12000",
  );
  assert.equal(result.http_proxy, "http://127.0.0.1:12000");
  assert.equal(result.https_proxy, "http://127.0.0.1:12000");
  assert.equal(result.NO_PROXY, input.NO_PROXY);
  assert.equal(result.GIT_CONFIG_PARAMETERS, input.GIT_CONFIG_PARAMETERS);
  assert.equal(input.http_proxy, undefined);
});

test("Git remote requests actually use the resolved proxy for their destination", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-git-proxy-"));
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(404);
    response.end("Isolated proxy fixture");
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const target = "http://unresolvable-research-fixture.invalid/paper.git";
    const runner = createGitRunner(
      {
        ...withoutProxy(process.env),
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      async (url) => {
        assert.equal(url, target);
        return "PROXY 127.0.0.1:" + server.address().port;
      },
    );
    await runner.run(root, ["init", "--initial-branch=main"]);
    await runner.run(root, ["remote", "add", "origin", target]);
    await assert.rejects(
      runner.remote(root, "origin", ["ls-remote", "origin", "HEAD"]),
      /not found|404/i,
    );
    assert.equal(requests[0], target + "/info/refs?service=git-upload-pack");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
