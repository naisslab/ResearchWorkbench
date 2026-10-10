const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const environment = require("./environment.cjs");
const execute = promisify(execFile);
let binary;
// /usr/bin/git is an xcrun shim; resolve the binary once per process.
const gitBinary = () =>
  (binary ??= execute("/usr/bin/xcrun", ["--find", "git"]).then(
    (result) => result.stdout.trim() || "/usr/bin/git",
    () => "/usr/bin/git",
  ));

function createGitRunner(env = environment) {
  const gitEnv = {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GH_PROMPT_DISABLED: "1",
  };
  async function run(folder, args, config = []) {
    try {
      const result = await execute(
        await gitBinary(),
        ["-C", await fs.realpath(folder), ...config, ...args],
        { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: gitEnv },
      );
      return result.stdout.trimEnd();
    } catch (error) {
      const message = error.killed
        ? `Git ${args[0]} timed out. Check your network and Git authentication in the local terminal.`
        : (error.stderr || error.message).trim();
      throw new Error(message.replace(/(https?:\/\/)[^\s/@]+@/g, "$1"));
    }
  }
  async function credentialConfig(folder, remoteName, push = false) {
    const remoteUrl = await run(folder, [
      "remote",
      "get-url",
      ...(push ? ["--push"] : []),
      remoteName,
    ]);
    let url;
    try {
      url = new URL(remoteUrl);
    } catch {
      return [];
    }
    if (url.protocol !== "https:" || url.hostname !== "github.com") return [];
    let gh;
    for (const directory of (env.PATH || "").split(path.delimiter)) {
      if (!path.isAbsolute(directory)) continue;
      const candidate = path.join(directory, "gh");
      if (
        await fs.access(candidate, fs.constants.X_OK).then(
          () => true,
          () => false,
        )
      ) {
        gh = candidate;
        break;
      }
    }
    if (!gh) return [];
    // Check local credentials without reading the token into the app.
    const authenticated = await new Promise((resolve) => {
      const child = spawn(gh, ["auth", "token", "--hostname", "github.com"], {
        env: gitEnv,
        stdio: "ignore",
        timeout: 5000,
      });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
    if (!authenticated) return [];
    const quoted = `'${gh.replace(/'/g, "'\\''")}'`;
    // Scope the helper to GitHub and keep config changes local to this command.
    return [
      "-c",
      "credential.https://github.com.helper=",
      "-c",
      `credential.https://github.com.helper=!${quoted} auth git-credential`,
    ];
  }
  async function remote(folder, remoteName, args) {
    return run(
      folder,
      args,
      await credentialConfig(folder, remoteName, args[0] === "push"),
    );
  }
  return { run, remote, credentialConfig };
}
module.exports = { createGitRunner };
