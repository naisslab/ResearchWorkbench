const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const {
  createGitRunner,
  createGitEnvironment,
} = require("../electron/git-runner.cjs");

test("GitHub commands reuse CLI credentials without changing Git config or other hosts", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "research-git-auth-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const tools = path.join(folder, "gh's tools");
  await fs.mkdir(tools);
  await fs.writeFile(
    path.join(tools, "gh"),
    `#!/bin/sh
if [ "$1" = auth ] && [ "$2" = token ]; then
  printf 'fixture-token'
  exit "$FIXTURE_AUTH_CODE"
fi
if [ "$1" = auth ] && [ "$2" = git-credential ] && [ "$3" = get ]; then
  cat >/dev/null
  printf 'username=fixture-user\\npassword=fixture-credential\\n'
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );
  const configFile = path.join(folder, "global.gitconfig");
  const globalConfig =
    "[credential]\n helper = \"!f() { cat >/dev/null; printf 'username=existing\\npassword=existing-secret\\n'; }; f\"\n";
  await fs.writeFile(configFile, globalConfig);
  const env = {
    ...process.env,
    PATH: `${tools}:/usr/bin:/bin`,
    FIXTURE_AUTH_CODE: "0",
    GIT_CONFIG_GLOBAL: configFile,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const runner = createGitRunner(env);
  await runner.run(folder, ["init", "--initial-branch=main"]);
  await runner.run(folder, [
    "remote",
    "add",
    "origin",
    "https://github.com/example/paper.git",
  ]);
  const config = await runner.credentialConfig(folder, "origin");
  assert.ok(config.length);
  async function credential(host, options = { env, config }) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "/usr/bin/git",
        ["-C", folder, ...options.config, "credential", "fill"],
        {
          env: { ...options.env, GIT_TERMINAL_PROMPT: "0" },
          timeout: 5000,
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin.end(`protocol=https\nhost=${host}\n\n`);
    });
  }
  assert.match(
    await credential("github.com"),
    /username=fixture-user\npassword=fixture-credential/,
  );
  assert.match(
    await credential("example.test"),
    /username=existing\npassword=existing-secret/,
  );
  const agentEnv = await createGitEnvironment({
    ...env,
    GIT_CONFIG_PARAMETERS: "'research.fixture=preserved'",
  });
  assert.match(
    await credential("github.com", { env: agentEnv, config: [] }),
    /username=fixture-user\npassword=fixture-credential/,
  );
  assert.match(
    await credential("example.test", { env: agentEnv, config: [] }),
    /username=existing\npassword=existing-secret/,
  );
  for (const [args, expected] of [
    [["config", "--get", "research.fixture"], "preserved"],
  ])
    assert.equal(
      (
        await execute("/usr/bin/git", ["-C", folder, ...args], {
          env: agentEnv,
        })
      ).stdout.trim(),
      expected,
    );
  assert.equal(await fs.readFile(configFile, "utf8"), globalConfig);
  assert.equal(
    (await runner.run(folder, ["config", "--local", "--list"])).includes(
      "credential",
    ),
    false,
  );
  assert.deepEqual(
    await createGitRunner({ ...env, FIXTURE_AUTH_CODE: "1" }).credentialConfig(
      folder,
      "origin",
    ),
    [],
  );
  const fallback = await createGitEnvironment({
    ...env,
    FIXTURE_AUTH_CODE: "1",
  });
  assert.match(
    await credential("github.com", { env: fallback, config: [] }),
    /username=existing\npassword=existing-secret/,
  );
  await runner.run(folder, [
    "remote",
    "set-url",
    "origin",
    "git@github.com:example/paper.git",
  ]);
  assert.deepEqual(await runner.credentialConfig(folder, "origin"), []);
  await runner.run(folder, [
    "remote",
    "set-url",
    "origin",
    "https://example.test/paper.git",
  ]);
  assert.deepEqual(await runner.credentialConfig(folder, "origin"), []);
  await assert.rejects(
    runner.run(folder, ["https://private-token@invalid.test/repo"]),
    (error) => {
      assert.equal(error.message.includes("private-token"), false);
      return true;
    },
  );
});

test("Desktop processes can find Homebrew tools with Finder's minimal PATH", async () => {
  const result = await execute(
    process.execPath,
    ["-e", 'console.log(require("./electron/environment.cjs").PATH)'],
    {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    },
  );
  for (const folder of [
    "/usr/bin",
    "/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Library/TeX/texbin",
  ]) {
    assert.ok(result.stdout.trim().split(path.delimiter).includes(folder));
  }
});
