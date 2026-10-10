const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const runFile = promisify(execFile);
let binary;
// /usr/bin/git is an xcrun shim; resolving the real binary once saves a process per call.
const gitBinary = () =>
  (binary ??= runFile("/usr/bin/xcrun", ["--find", "git"]).then(
    (result) => result.stdout.trim() || "/usr/bin/git",
    () => "/usr/bin/git",
  ));
async function run(folder, args) {
  try {
    const result = await runFile(
      await gitBinary(),
      ["-C", await fs.realpath(folder), ...args],
      {
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    return result.stdout.trimEnd();
  } catch (error) {
    throw new Error((error.stderr || error.message).trim());
  }
}
function displayRemote(remote) {
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return remote;
  }
}
const hasRef = (folder, ref) =>
  run(folder, ["show-ref", "--verify", "--quiet", ref]).then(
    () => true,
    () => false,
  );
// Repository root, used as the operation lock key; a plain folder locks on its real path.
const toplevel = (folder) =>
  run(folder, ["rev-parse", "--show-toplevel"]).catch(() =>
    fs.realpath(folder),
  );
async function status(folder) {
  let repository, output, remoteList, log;
  try {
    [repository, output, remoteList, log] = await Promise.all([
      run(folder, ["rev-parse", "--show-toplevel"]),
      run(folder, [
        "status",
        "--porcelain=v1",
        "-z",
        "--branch",
        "--untracked-files=all",
      ]),
      run(folder, ["remote", "-v"]),
      // An unborn HEAD has no log.
      run(folder, ["log", "-8", "--format=%h%x00%s%x00%an%x00%aI"]).catch(
        () => "",
      ),
    ]);
  } catch (error) {
    if (/not a git repository/i.test(error.message))
      return {
        connected: false,
        branch: "",
        remote: "",
        changes: [],
        ahead: 0,
        behind: 0,
      };
    throw error;
  }
  const parts = output.split("\0");
  // "## main...origin/main [ahead 1, behind 2]", "## main", "## HEAD (no branch)"
  const [, branch, upstream = "", track = ""] =
    /^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(
      parts.shift() || "",
    ) || [];
  const changes = [];
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index];
    if (!entry) continue;
    const file = entry.slice(3);
    if (!file.split("/").includes(".research-build"))
      changes.push({
        status: entry.slice(0, 2),
        file,
        ...(/R/.test(entry.slice(0, 2))
          ? { originalFile: parts[index + 1] }
          : {}),
      });
    if (/R|C/.test(entry.slice(0, 2))) index++;
  }
  const remotes = new Map(
    remoteList
      .split("\n")
      .filter((line) => line.endsWith(" (fetch)"))
      .map((line) => line.slice(0, -8).split("\t")),
  );
  const tracking = [...remotes.keys()].find((name) =>
    upstream.startsWith(`${name}/`),
  );
  const remoteName =
    tracking ||
    (remotes.has("origin") ? "origin" : [...remotes.keys()][0]) ||
    "";
  const remoteBranch = tracking ? upstream.slice(tracking.length + 1) : branch;
  let ahead = 0,
    behind = 0,
    hasRemoteBranch = false;
  if (tracking && track !== "gone") {
    hasRemoteBranch = true;
    ahead = Number(/ahead (\d+)/.exec(track)?.[1] || 0);
    behind = Number(/behind (\d+)/.exec(track)?.[1] || 0);
  } else if (remoteName) {
    // Without an upstream, compare with the same branch name on the remote.
    const remoteRef = `refs/remotes/${remoteName}/${remoteBranch}`;
    hasRemoteBranch = await hasRef(folder, remoteRef);
    if (log)
      [ahead, behind] = hasRemoteBranch
        ? (
            await run(folder, [
              "rev-list",
              "--left-right",
              "--count",
              `HEAD...${remoteRef}`,
            ])
          )
            .split(/\s+/)
            .map(Number)
        : [Number(await run(folder, ["rev-list", "--count", "HEAD"])), 0];
  }
  return {
    connected: true,
    repository,
    branch,
    remote: remoteName ? displayRemote(remotes.get(remoteName)) : "",
    remoteName,
    remoteBranch,
    hasRemoteBranch,
    detached: branch.startsWith("HEAD"),
    history: log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, author, date] = line.split("\0");
        return { hash, subject, author, date };
      }),
    changes,
    ahead,
    behind,
  };
}
async function init(folder) {
  const current = await status(folder);
  if (!current.connected) await run(folder, ["init", "--initial-branch=main"]);
  return status(folder);
}
async function diff(folder, file) {
  const current = await status(folder);
  const change = current.changes.find((item) => item.file === file);
  if (!change)
    throw new Error("This file is no longer changed. Refresh the repository.");
  let text;
  if (change.status === "??" || !current.history.length) {
    // Preview new files without following links outside the repository.
    const target = path.resolve(current.repository, file);
    if (!target.startsWith(`${current.repository}${path.sep}`))
      throw new Error("Invalid file path.");
    const realParent = await fs.realpath(path.dirname(target));
    if (
      realParent !== current.repository &&
      !realParent.startsWith(`${current.repository}${path.sep}`)
    )
      throw new Error("File is outside the repository.");
    const metadata = await fs.lstat(target);
    if (metadata.isSymbolicLink())
      text = `Symbolic link → ${await fs.readlink(target)}`;
    else if (!metadata.isFile())
      text = "Preview is unavailable for this file type.";
    else if (metadata.size > 512 * 1024)
      text = "This file is too large for an inline preview.";
    else {
      const contents = await fs.readFile(target);
      text = contents.includes(0)
        ? "Binary file. Content preview is unavailable."
        : `--- /dev/null\n+++ b/${file}\n@@ New file @@\n${contents
            .toString("utf8")
            .split("\n")
            .map((line) => `+${line}`)
            .join("\n")}`;
    }
  } else {
    text = await run(current.repository, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "HEAD",
      "--",
      `:(literal)${file}`,
    ]);
    if (!text)
      text =
        "No text difference from the last commit. The file mode or index may have changed.";
  }
  const lines = text.split("\n");
  return {
    file,
    text: lines.slice(0, 1200).join("\n"),
    truncated: lines.length > 1200,
  };
}
async function connect(folder, url) {
  if (
    typeof url !== "string" ||
    !url.trim() ||
    url.startsWith("-") ||
    /[\r\n\0]/.test(url) ||
    !/^(https?:\/\/|ssh:\/\/|git@|\/)/.test(url)
  )
    throw new Error("Enter an HTTPS or SSH Git repository URL.");
  const current = await status(folder);
  if (current.remote)
    throw new Error(
      "A remote is already connected. Update it in the terminal if needed.",
    );
  if (!current.connected) await run(folder, ["init", "--initial-branch=main"]);
  await run(folder, ["remote", "add", "origin", url.trim()]);
  return status(folder);
}
async function commit(folder, message, files) {
  if (typeof message !== "string" || !message.trim() || message.length > 1000)
    throw new Error("Enter a commit message.");
  const current = await status(folder);
  if (!current.connected) throw new Error("Connect a Git repository first.");
  if (!current.changes.length)
    throw new Error("There are no file changes to commit.");
  if (
    current.changes.some((change) =>
      ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(change.status),
    )
  )
    throw new Error(
      "Resolve merge conflicts in the terminal before committing.",
    );
  // Check identity before staging to keep failed commits from changing the index.
  await run(folder, ["var", "GIT_AUTHOR_IDENT"]);
  const selected =
    files === undefined ? current.changes.map((change) => change.file) : files;
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.some(
      (file) => !current.changes.some((change) => change.file === file),
    )
  )
    throw new Error(
      "Select changed files to commit. Refresh if the file list has changed.",
    );
  const included = selected.flatMap((file) => {
    const change = current.changes.find((item) => item.file === file);
    return change.originalFile ? [file, change.originalFile] : [file];
  });
  const paths = [...new Set(included)].map((file) => `:(literal)${file}`);
  const stagePaths = selected.filter((file) =>
    current.changes.some(
      (change) => change.file === file && change.status !== "D ",
    ),
  );
  if (stagePaths.length)
    await run(current.repository, [
      "add",
      "--all",
      "--",
      ...stagePaths.map((file) => `:(literal)${file}`),
    ]);
  // --only leaves unrelated staged work in the index for a later commit.
  await run(current.repository, [
    "commit",
    "--only",
    "-m",
    message.trim(),
    "--",
    ...paths,
  ]);
  return status(folder);
}
async function sync(folder, direction = "sync") {
  if (!["fetch", "pull", "push", "sync"].includes(direction))
    throw new Error("Invalid Git operation.");
  const current = await status(folder);
  if (!current.remote) throw new Error("Connect a Git remote first.");
  if (direction === "fetch") {
    await run(folder, ["fetch", current.remoteName]);
    return status(folder);
  }
  if (current.changes.length)
    throw new Error("Commit or stash local changes before syncing.");
  if (current.branch.startsWith("HEAD"))
    throw new Error("Check out a branch before syncing.");
  if (direction !== "push") {
    await run(folder, ["fetch", current.remoteName]);
    if (
      await hasRef(
        folder,
        `refs/remotes/${current.remoteName}/${current.remoteBranch}`,
      )
    )
      await run(folder, [
        "pull",
        "--ff-only",
        current.remoteName,
        current.remoteBranch,
      ]);
  }
  if (direction !== "pull")
    await run(folder, [
      "push",
      "--set-upstream",
      current.remoteName,
      `${current.branch}:refs/heads/${current.remoteBranch}`,
    ]);
  return status(folder);
}
module.exports = { toplevel, status, init, diff, connect, commit, sync };
