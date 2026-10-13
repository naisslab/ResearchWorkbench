const fs = require("node:fs/promises");
const path = require("node:path");
const { run, remote } = require("./git-runner.cjs").createGitRunner();
const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
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
      run(folder, ["log", "-8", "--format=%H%x00%s%x00%an%x00%aI"]).catch(
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
  const defaultRef = remoteName
    ? await run(folder, [
        "symbolic-ref",
        "--quiet",
        `refs/remotes/${remoteName}/HEAD`,
      ]).catch(() => "")
    : "";
  const remoteBranch = tracking
    ? upstream.slice(tracking.length + 1)
    : defaultRef.startsWith(`refs/remotes/${remoteName}/`)
      ? defaultRef.slice(`refs/remotes/${remoteName}/`.length)
      : branch;
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
function validateRemote(url) {
  if (
    typeof url !== "string" ||
    !url.trim() ||
    url.startsWith("-") ||
    /[\r\n\0]/.test(url) ||
    !/^(https?:\/\/|ssh:\/\/|git@|\/)/.test(url)
  )
    throw new Error("Enter an HTTPS or SSH Git repository URL.");
  url = url.trim();
  if (/^(?:https?|ssh):\/\//i.test(url)) {
    const parsed = new URL(url);
    if (parsed.password || (parsed.protocol !== "ssh:" && parsed.username))
      throw new Error(
        "Keep credentials out of repository URLs. Use a Git credential manager or the Overleaf connection dialog.",
      );
    if (parsed.hash || parsed.search)
      throw new Error("Repository URLs cannot contain a query or fragment.");
  }
  return url;
}
async function discoverDefault(folder, remoteName) {
  const output = await remote(folder, remoteName, [
    "ls-remote",
    "--symref",
    remoteName,
    "HEAD",
  ]);
  const name = /^ref: refs\/heads\/([^\t\r\n]+)\tHEAD$/m.exec(output)?.[1];
  if (name) {
    await run(folder, ["check-ref-format", `refs/heads/${name}`]);
    await run(folder, [
      "symbolic-ref",
      `refs/remotes/${remoteName}/HEAD`,
      `refs/remotes/${remoteName}/${name}`,
    ]);
  }
  return name;
}
async function connect(folder, url) {
  url = validateRemote(url);
  const current = await status(folder);
  if (current.remote)
    throw new Error(
      "A remote is already connected. Update it in the terminal if needed.",
    );
  if (!current.connected) await run(folder, ["init", "--initial-branch=main"]);
  await run(folder, ["remote", "add", "origin", url]);
  try {
    await discoverDefault(folder, "origin");
  } catch (error) {
    await run(folder, ["remote", "remove", "origin"]);
    throw error;
  }
  return status(folder);
}
async function clone(url, destination) {
  url = validateRemote(url);
  if (typeof destination !== "string" || !path.isAbsolute(destination))
    throw new Error("Choose an absolute destination folder.");
  if (
    await fs.lstat(destination).then(
      () => true,
      (e) => {
        if (e.code !== "ENOENT") throw e;
        return false;
      },
    )
  )
    throw new Error("Clone into a new folder to preserve existing files.");
  const parent = await fs.realpath(path.dirname(destination));
  const temporary = await fs.mkdtemp(path.join(parent, ".research-clone-"));
  try {
    await connect(temporary, url);
    await sync(temporary, "pull");
    const current = await status(temporary);
    if (!current.history.length)
      throw new Error("The remote repository has no commits.");
    await run(temporary, [
      "branch",
      "--set-upstream-to",
      `${current.remoteName}/${current.remoteBranch}`,
    ]);
    await fs.rename(temporary, destination);
    return status(destination);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
async function commit(folder, message, files) {
  if (typeof message !== "string" || !message.trim() || message.length > 1000)
    throw new Error("Enter a commit message.");
  const current = await status(folder);
  if (!current.connected) throw new Error("Connect a Git repository first.");
  if (!current.changes.length)
    throw new Error("There are no file changes to commit.");
  if (current.changes.some((change) => conflicts.has(change.status)))
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
  let current = await status(folder);
  if (!current.remote) throw new Error("Connect a Git remote first.");
  if (direction === "fetch") {
    await remote(folder, current.remoteName, [
      "fetch",
      "--prune",
      current.remoteName,
    ]);
    await discoverDefault(folder, current.remoteName);
    return status(folder);
  }
  if (current.changes.some((change) => conflicts.has(change.status)))
    throw new Error("Resolve merge conflicts in the terminal before syncing.");
  if (current.branch.startsWith("HEAD"))
    throw new Error("Check out a branch before syncing.");
  if (direction !== "push") {
    await remote(folder, current.remoteName, [
      "fetch",
      "--prune",
      current.remoteName,
    ]);
    await discoverDefault(folder, current.remoteName);
    current = await status(folder);
    if (
      await hasRef(
        folder,
        `refs/remotes/${current.remoteName}/${current.remoteBranch}`,
      )
    )
      await run(folder, [
        "merge",
        "--ff-only",
        `refs/remotes/${current.remoteName}/${current.remoteBranch}`,
      ]);
    else if (direction === "pull")
      throw new Error(
        `Remote branch ${current.remoteBranch} is unavailable. Check the remote and its default branch.`,
      );
  }
  if (direction !== "pull")
    await remote(folder, current.remoteName, [
      "push",
      "--set-upstream",
      current.remoteName,
      `${current.branch}:refs/heads/${current.remoteBranch}`,
    ]);
  return status(folder);
}
module.exports = {
  toplevel,
  status,
  init,
  diff,
  connect,
  clone,
  validateRemote,
  discoverDefault,
  commit,
  sync,
};
