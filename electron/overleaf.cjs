const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createGitRunner } = require("./git-runner.cjs");
const {
  parseOverleafUrl,
  createTokenStore,
  withOverleafCredential,
  writePrivate,
} = require("./overleaf-auth.cjs");

const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const oid = (value) => /^[a-f\d]{40,64}$/.test(value || "");
const terminal = new Set(["cancelled", "published"]);
const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const previewLimit = 512 * 1024;

/** Local, explicit Overleaf source synchronization. No browser/session APIs. */
function createOverleaf({
  directory,
  encryption,
  git = createGitRunner(),
  transport,
} = {}) {
  if (!directory || !path.isAbsolute(directory))
    throw new Error("An absolute Overleaf state directory is required.");
  const credentials = createTokenStore(
    path.join(directory, "credentials"),
    encryption,
  );
  const busy = new Set();
  const key = (projectId) => {
    if (typeof projectId !== "string" || !projectId || projectId.length > 512)
      throw new Error("Invalid project.");
    return digest(projectId);
  };
  const location = (projectId, name) =>
    path.join(directory, key(projectId), `${name}.json`);
  const read = async (projectId, name) => {
    try {
      return JSON.parse(await fs.readFile(location(projectId, name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(
        "The saved Overleaf state could not be read. Its files have been preserved.",
      );
    }
  };
  const save = (projectId, name, value) =>
    writePrivate(location(projectId, name), JSON.stringify(value, null, 2));
  async function locked(projectId, operation) {
    const lock = key(projectId);
    if (busy.has(lock))
      throw new Error(
        "An Overleaf operation is already running for this project.",
      );
    busy.add(lock);
    try {
      return await operation();
    } finally {
      busy.delete(lock);
    }
  }
  const run = (folder, args, options) =>
    git.run(folder, args, ["-c", "core.hooksPath=/dev/null"], {}, options);
  async function connection(projectId) {
    const item = await read(projectId, "connection");
    if (!item) throw new Error("Connect this project to Overleaf first.");
    parseOverleafUrl(item.gitUrl);
    if (!path.isAbsolute(item.folder))
      throw new Error("Invalid saved manuscript folder.");
    await run(item.folder, [
      "check-ref-format",
      `refs/heads/${item.remoteBranch}`,
    ]);
    return item;
  }
  const publicConnection = ({ credentialRef, ...value }) => value;
  async function request(folder, args, item, options) {
    const token = await credentials.get(item.credentialRef);
    return transport
      ? transport({
          folder,
          args,
          connection: publicConnection(item),
          token,
          git,
          options,
        })
      : withOverleafCredential(git, folder, args, item, token, options);
  }
  const remoteRef = (item) =>
    `refs/remotes/research-overleaf/${item.remoteBranch}`;
  async function head(folder, reference = "HEAD") {
    return run(folder, [
      "rev-parse",
      "--verify",
      `${reference}^{commit}`,
    ]).catch(() => "");
  }
  async function changes(folder) {
    const raw = await run(folder, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const entries = raw.split("\0"),
      result = [];
    for (let index = 0; index < entries.length; index++) {
      if (!entries[index]) continue;
      const status = entries[index].slice(0, 2),
        file = entries[index].slice(3);
      if (!file.split("/").includes(".research-build"))
        result.push({ status, file });
      if (/[RC]/.test(status)) index++;
    }
    return result;
  }
  async function inspect(item) {
    const [localHead, remoteHead, branch, dirtyFiles] = await Promise.all([
      head(item.folder),
      head(item.folder, remoteRef(item)),
      run(item.folder, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
        () => "",
      ),
      changes(item.folder),
    ]);
    let ahead = 0,
      behind = 0;
    if (localHead && remoteHead)
      [ahead, behind] = (
        await run(item.folder, [
          "rev-list",
          "--left-right",
          "--count",
          `${localHead}...${remoteHead}`,
        ])
      )
        .split(/\s+/)
        .map(Number);
    return {
      head: localHead,
      remoteHead,
      branch,
      dirty: dirtyFiles.length > 0,
      changes: dirtyFiles,
      ahead,
      behind,
    };
  }
  async function fetchRemote(projectId, item) {
    await request(
      item.folder,
      [
        "fetch",
        "--no-tags",
        item.gitUrl,
        `+refs/heads/${item.remoteBranch}:${remoteRef(item)}`,
      ],
      item,
    );
    item.lastFetchedAt = new Date().toISOString();
    await save(projectId, "connection", item);
    return head(item.folder, remoteRef(item));
  }
  async function transaction(projectId, id) {
    const tx = await read(projectId, "transaction");
    if (!tx || tx.id !== id)
      throw new Error("This review is no longer current. Start a new review.");
    const expected = path.join(directory, key(projectId), "reviews", tx.id);
    if (
      !/^[a-f\d-]{36}$/.test(tx.id) ||
      tx.worktree !== expected ||
      !oid(tx.baseHead) ||
      !oid(tx.remoteHead) ||
      !oid(tx.mergeBase) ||
      (tx.resultHead && !oid(tx.resultHead)) ||
      tx.checkpointRef !== `refs/research-overleaf/checkpoints/${tx.id}`
    )
      throw new Error("Invalid saved Overleaf review.");
    return tx;
  }
  async function update(projectId, tx, values) {
    Object.assign(tx, values, { updatedAt: new Date().toISOString() });
    await save(projectId, "transaction", tx);
  }
  function publicTransaction(tx) {
    if (!tx) return undefined;
    const { worktree, checkpointRef, ...value } = tx;
    return value;
  }
  async function recover(projectId, item, ownOperation = false) {
    const saved = await read(projectId, "transaction");
    if (!saved) return null;
    const tx = await transaction(projectId, saved.id);
    if (busy.has(key(projectId)) && !ownOperation) return tx;
    if (tx.stage === "applying") {
      const current = await head(item.folder);
      if (current === tx.resultHead)
        await update(projectId, tx, { stage: "applied" });
      else if (current === tx.baseHead)
        await update(projectId, tx, { stage: "ready" });
      else
        await update(projectId, tx, {
          stage: "failed",
          error:
            "The manuscript changed during an interrupted apply. The checkpoint and review were preserved.",
        });
    }
    if (tx.stage === "preparing")
      await update(projectId, tx, {
        stage: "failed",
        error:
          "Review preparation was interrupted. Cancel this review and start again; the manuscript was not changed.",
      });
    return tx;
  }
  async function status(projectId) {
    const item = await read(projectId, "connection");
    if (!item)
      return {
        connected: false,
        secureStorageAvailable: credentials.available(),
      };
    const state = await inspect(item);
    const tx = await recover(projectId, item);
    const detailed =
      tx && ["conflicts", "ready", "applied"].includes(tx.stage)
        ? await review(projectId, tx.id)
        : publicTransaction(tx);
    return {
      connected: true,
      connection: publicConnection(item),
      ...state,
      transaction: detailed,
      secureStorageAvailable: credentials.available(),
    };
  }
  async function discover(folder, item) {
    const output = await request(
      folder,
      [
        "ls-remote",
        "--symref",
        item.gitUrl,
        "HEAD",
        "refs/heads/main",
        "refs/heads/master",
      ],
      item,
    );
    let branch = /^ref: refs\/heads\/([^\t\r\n]+)\tHEAD$/m.exec(output)?.[1];
    if (!branch) {
      const remoteHead = /^([a-f\d]{40,64})\tHEAD$/m.exec(output)?.[1];
      const matching = [
        ...output.matchAll(/^([a-f\d]{40,64})\trefs\/heads\/(main|master)$/gm),
      ].filter((match) => !remoteHead || match[1] === remoteHead);
      if (matching.length === 1) branch = matching[0][2];
    }
    if (!branch)
      throw new Error(
        "Overleaf did not report a usable default branch. Verify access and try again.",
      );
    await run(folder, ["check-ref-format", `refs/heads/${branch}`]);
    return branch;
  }
  async function connect(
    { projectId, folder, url, token, mode = "review", clone = false },
    register,
  ) {
    return locked(projectId, async () => {
      if (!["review", "publish"].includes(mode))
        throw new Error("Choose review or publish mode.");
      if (typeof folder !== "string" || !path.isAbsolute(folder))
        throw new Error("Choose an absolute manuscript folder.");
      const parsed = parseOverleafUrl(url);
      const previous = await read(projectId, "connection");
      const pending = await read(projectId, "transaction");
      if (pending && !terminal.has(pending.stage))
        throw new Error(
          "Finish or cancel the current Overleaf review before reconnecting.",
        );
      const credentialRef = token
        ? await credentials.put(token)
        : previous?.credentialRef;
      if (!credentialRef)
        throw new Error("Enter your Overleaf access token to connect.");
      const item = {
        projectId,
        folder,
        ...parsed,
        mode,
        credentialRef,
        createdAt: new Date().toISOString(),
      };
      let temporary,
        committed = false;
      try {
        if (clone) {
          if (
            await fs.lstat(folder).then(
              () => true,
              (error) => {
                if (error.code !== "ENOENT") throw error;
                return false;
              },
            )
          )
            throw new Error(
              "Clone into a new folder. Existing files will not be overwritten.",
            );
          const parent = await fs.realpath(path.dirname(folder));
          temporary = await fs.mkdtemp(path.join(parent, ".overleaf-clone-"));
          item.remoteBranch = await discover(parent, item);
          await run(temporary, [
            "init",
            `--initial-branch=${item.remoteBranch}`,
          ]);
          await request(
            temporary,
            [
              "fetch",
              "--no-tags",
              item.gitUrl,
              `+refs/heads/${item.remoteBranch}:${remoteRef(item)}`,
            ],
            item,
          );
          const revision = await head(temporary, remoteRef(item));
          if (!revision)
            throw new Error("The Overleaf project has no source revision.");
          await run(temporary, ["reset", "--hard", revision]);
          await fs.rename(temporary, folder);
          temporary = undefined;
        } else {
          const root = await run(folder, ["rev-parse", "--show-toplevel"]);
          if ((await fs.realpath(root)) !== (await fs.realpath(folder)))
            throw new Error(
              "Attach the repository root as the manuscript folder before connecting Overleaf.",
            );
          if (!(await head(folder)))
            throw new Error(
              "Clone from Overleaf first, or commit the existing manuscript before connecting.",
            );
          item.remoteBranch = await discover(folder, item);
          await request(
            folder,
            [
              "fetch",
              "--no-tags",
              item.gitUrl,
              `+refs/heads/${item.remoteBranch}:${remoteRef(item)}`,
            ],
            item,
          );
          if (
            !(await run(folder, ["merge-base", "HEAD", remoteRef(item)]).catch(
              () => "",
            ))
          )
            throw new Error(
              "These sources have unrelated histories. Clone the Overleaf project into a new folder, then copy and review your local edits there.",
            );
        }
        item.folder = await fs.realpath(folder);
        item.lastFetchedAt = new Date().toISOString();
        if (
          previous?.folder === item.folder &&
          previous?.gitUrl === item.gitUrl
        ) {
          item.createdAt = previous.createdAt;
          item.lastPublishedAt = previous.lastPublishedAt;
          item.lastPublishedHead = previous.lastPublishedHead;
        }
        // The caller registers the manuscript before prior connection credentials
        // are retired. A failed workspace save leaves the prior connection valid.
        if (register) await register(publicConnection(item));
        await save(projectId, "connection", item);
        committed = true;
        if (previous && pending) {
          await cleanup(previous, await transaction(projectId, pending.id));
          await fs.rm(location(projectId, "transaction"), { force: true });
        }
        if (previous?.credentialRef && previous.credentialRef !== credentialRef)
          await credentials.remove(previous.credentialRef);
        return status(projectId);
      } catch (error) {
        if (temporary) await fs.rm(temporary, { recursive: true, force: true });
        if (!committed && credentialRef !== previous?.credentialRef)
          await credentials.remove(credentialRef);
        error.connectionCommitted = committed;
        throw error;
      }
    });
  }
  async function replaceCredential(projectId, token) {
    return locked(projectId, async () => {
      const item = await connection(projectId);
      const credentialRef = await credentials.put(token);
      const next = { ...item, credentialRef };
      let committed = false;
      try {
        await discover(item.folder, next);
        await save(projectId, "connection", next);
        committed = true;
        await credentials.remove(item.credentialRef);
        return status(projectId);
      } catch (error) {
        if (!committed) await credentials.remove(credentialRef);
        throw error;
      }
    });
  }
  async function check(projectId) {
    return locked(projectId, async () => {
      const item = await connection(projectId);
      const remoteHead = await fetchRemote(projectId, item);
      const tx = await recover(projectId, item, true);
      if (tx?.stage === "publishing") {
        const present =
          remoteHead === tx.resultHead ||
          (await run(item.folder, [
            "merge-base",
            "--is-ancestor",
            tx.resultHead,
            remoteHead,
          ]).then(
            () => true,
            () => false,
          ));
        if (present) {
          await update(projectId, tx, { stage: "published", error: undefined });
          item.lastPublishedAt = tx.updatedAt;
          item.lastPublishedHead = tx.resultHead;
          await save(projectId, "connection", item);
        } else
          await update(projectId, tx, {
            stage: "applied",
            error:
              remoteHead === tx.remoteHead
                ? "The remote did not receive the previous publish. Review and retry."
                : "Overleaf changed during the previous publish. Create a fresh review before publishing.",
          });
      }
      const state = await status(projectId);
      const base =
        state.head &&
        (await run(item.folder, [
          "merge-base",
          state.head,
          state.remoteHead,
        ]).catch(() => ""));
      return {
        ...state,
        incomingDiff: base
          ? await sourceDiff(item.folder, base, state.remoteHead)
          : undefined,
        unrelatedHistory: !base,
      };
    });
  }
  async function requireClean(item, expectedHead) {
    const state = await inspect(item);
    if (!state.head || !state.branch)
      throw new Error(
        "Check out a manuscript branch before reviewing Overleaf changes.",
      );
    if (state.dirty)
      throw new Error(
        "Save and commit local changes before reviewing Overleaf changes. Your source files were preserved.",
      );
    if (expectedHead && state.head !== expectedHead)
      throw new Error(
        "The local revision changed. Refresh and start a new review.",
      );
    if (
      await run(item.folder, ["rev-parse", "--verify", "MERGE_HEAD"]).then(
        () => true,
        () => false,
      )
    )
      throw new Error(
        "Finish the existing Git merge before reviewing Overleaf changes.",
      );
    return state;
  }
  async function supportedTree(folder, revision) {
    const entries = (await run(folder, ["ls-tree", "-r", "-z", revision]))
      .split("\0")
      .filter(Boolean);
    for (const entry of entries) {
      const match = /^(\d+) \w+ ([a-f\d]+)\t([\s\S]+)$/.exec(entry);
      if (match && ["120000", "160000"].includes(match[1]))
        throw new Error(
          `Overleaf source synchronization does not support ${match[1] === "120000" ? "symbolic links" : "submodules"}: ${match[3]}. Replace them with ordinary source files before reviewing.`,
        );
    }
    const pointers = await run(folder, [
      "grep",
      "-l",
      "-z",
      "-F",
      "version https://git-lfs.github.com/spec/v1",
      revision,
      "--",
    ]).catch((error) => {
      if (error.exitCode === 1) return "";
      throw error;
    });
    for (const reference of pointers.split("\0").filter(Boolean)) {
      const size = Number(await run(folder, ["cat-file", "-s", reference]));
      if (size > 2048) continue;
      const contents = await run(folder, ["cat-file", "blob", reference]);
      if (
        /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/.test(
          contents,
        ) &&
        /^oid sha256:[a-f\d]{64}$/m.test(contents)
      )
        throw new Error(
          `Overleaf source synchronization does not support Git LFS pointers: ${reference.slice(revision.length + 1)}. Replace the pointer with the actual file before reviewing.`,
        );
    }
  }
  async function plan(projectId, expected = {}) {
    return locked(projectId, async () => {
      const item = await connection(projectId);
      const old = await recover(projectId, item, true);
      if (old && !terminal.has(old.stage))
        throw new Error(
          "Finish or cancel the current review before starting another.",
        );
      const state = await requireClean(item, expected.expectedHead);
      const remoteHead = await fetchRemote(projectId, item);
      if (
        expected.expectedRemoteHead &&
        expected.expectedRemoteHead !== remoteHead
      )
        throw new Error(
          "Overleaf changed since the last check. Review the new incoming revision.",
        );
      const mergeBase = await run(item.folder, [
        "merge-base",
        state.head,
        remoteHead,
      ]).catch(() => "");
      if (!mergeBase)
        throw new Error(
          "The local manuscript and Overleaf do not share a history. Clone a new copy before importing changes.",
        );
      await supportedTree(item.folder, state.head);
      await supportedTree(item.folder, remoteHead);
      if (old) await cleanup(item, old);
      const id = crypto.randomUUID();
      const tx = {
        id,
        stage: "preparing",
        baseHead: state.head,
        remoteHead,
        mergeBase,
        branch: state.branch,
        worktree: path.join(directory, key(projectId), "reviews", id),
        checkpointRef: `refs/research-overleaf/checkpoints/${id}`,
        createdAt: new Date().toISOString(),
      };
      await update(projectId, tx, {});
      try {
        await run(item.folder, ["update-ref", tx.checkpointRef, state.head]);
        await fs.mkdir(path.dirname(tx.worktree), {
          recursive: true,
          mode: 0o700,
        });
        await run(item.folder, [
          "worktree",
          "add",
          "--detach",
          tx.worktree,
          remoteHead,
        ]);
        await run(tx.worktree, [
          "merge",
          "--squash",
          "--no-commit",
          state.head,
        ]).catch(async (error) => {
          if (
            !(await changes(tx.worktree)).some((entry) =>
              conflictCodes.has(entry.status),
            )
          )
            throw error;
        });
        const unresolved = (await changes(tx.worktree)).some((entry) =>
          conflictCodes.has(entry.status),
        );
        await update(projectId, tx, {
          stage: unresolved ? "conflicts" : "ready",
        });
        return review(projectId, id);
      } catch (error) {
        await update(projectId, tx, { stage: "failed", error: error.message });
        throw error;
      }
    });
  }
  async function conflictEntries(tx) {
    const entries = new Map();
    const output = await run(tx.worktree, ["ls-files", "--unmerged", "-z"]);
    for (const entry of output.split("\0").filter(Boolean)) {
      const match = /^(\d+) ([a-f\d]+) ([123])\t([\s\S]+)$/.exec(entry);
      if (!match) continue;
      const [, mode, hash, stage, file] = match;
      if (!entries.has(file)) entries.set(file, { file, stages: {} });
      entries.get(file).stages[stage] = { mode, hash };
    }
    return [...entries.values()];
  }
  async function blobPreview(tx, entry) {
    if (!entry) return { exists: false, binary: false, text: "" };
    const size = Number(await run(tx.worktree, ["cat-file", "-s", entry.hash]));
    if (size > previewLimit)
      return { exists: true, binary: true, text: "", size, truncated: true };
    const content = await run(tx.worktree, ["cat-file", "blob", entry.hash], {
      encoding: "buffer",
    });
    const binary = content.includes(0) || entry.mode === "120000";
    return {
      exists: true,
      binary,
      text: binary ? "" : content.toString("utf8"),
      size,
    };
  }
  async function sourceDiff(folder, from, to) {
    const text = await run(
      folder,
      ["diff", "--no-ext-diff", "--no-textconv", "--no-color", from, to],
      { maxBuffer: 32 * 1024 * 1024, preserveOutput: true },
    );
    return {
      text: text.slice(0, previewLimit),
      truncated: text.length > previewLimit,
    };
  }
  async function review(projectId, id) {
    const tx = await transaction(projectId, id);
    if (terminal.has(tx.stage) || tx.stage === "failed")
      return publicTransaction(tx);
    const conflicts = await conflictEntries(tx);
    const diff = await run(
      tx.worktree,
      ["diff", "--no-ext-diff", "--no-textconv", "--no-color", tx.remoteHead],
      { maxBuffer: 32 * 1024 * 1024, preserveOutput: true },
    );
    const files = await changes(tx.worktree);
    const tree = conflicts.length ? "" : await run(tx.worktree, ["write-tree"]);
    // Includes unstaged text as well as the index, so external edits invalidate review/compile approval.
    const reviewToken = digest(
      JSON.stringify([
        tx.id,
        tx.baseHead,
        tx.remoteHead,
        tree,
        diff,
        files,
        conflicts,
      ]),
    );
    const expanded = await Promise.all(
      conflicts.map(async ({ file, stages }) => ({
        file,
        base: await blobPreview(tx, stages[1]),
        local: await blobPreview(tx, stages[3]),
        remote: await blobPreview(tx, stages[2]),
      })),
    );
    return {
      ...publicTransaction(tx),
      ...(tx.compile?.ok && tx.compile.reviewToken !== reviewToken
        ? {
            compile: {
              ...tx.compile,
              ok: false,
              message:
                "The review changed after compilation. Compile the current source again.",
            },
          }
        : {}),
      reviewToken,
      files,
      diff: {
        text: diff.slice(0, previewLimit),
        truncated: diff.length > previewLimit,
      },
      incomingDiff: await sourceDiff(tx.worktree, tx.mergeBase, tx.remoteHead),
      conflicts: expanded,
    };
  }
  async function safeTarget(tx, file) {
    if (
      typeof file !== "string" ||
      !file ||
      file.includes("\0") ||
      file
        .split(/[\\/]/)
        .some((part) => part === ".." || part.toLowerCase() === ".git") ||
      path.isAbsolute(file)
    )
      throw new Error("Invalid conflict file.");
    const target = path.resolve(tx.worktree, file);
    if (!target.startsWith(`${tx.worktree}${path.sep}`))
      throw new Error("Invalid conflict file.");
    const parent = await fs.realpath(path.dirname(target));
    const root = await fs.realpath(tx.worktree);
    if (parent !== root && !parent.startsWith(`${root}${path.sep}`))
      throw new Error("The conflict path leaves the review folder.");
    return target;
  }
  async function resolve(projectId, id, { file, choice, text }) {
    return locked(projectId, async () => {
      const tx = await transaction(projectId, id);
      if (!["conflicts", "ready"].includes(tx.stage))
        throw new Error("This review cannot be edited at its current stage.");
      const conflict = (await conflictEntries(tx)).find(
        (entry) => entry.file === file,
      );
      if (!conflict)
        throw new Error("Choose an unresolved file from this review.");
      const target = await safeTarget(tx, file);
      if (!["local", "remote", "base", "text"].includes(choice))
        throw new Error("Choose local, remote, base, or edited text.");
      if (choice === "text") {
        if (
          typeof text !== "string" ||
          Buffer.byteLength(text) > 2 * 1024 * 1024 ||
          text.includes("\0")
        )
          throw new Error("Conflict text must be smaller than 2 MB.");
        await fs.rm(target, { force: true });
        await fs.writeFile(target, text);
      } else {
        const entry = conflict.stages[{ base: 1, remote: 2, local: 3 }[choice]];
        if (entry && ["120000", "160000"].includes(entry.mode))
          throw new Error(
            "Resolve symbolic links and submodules outside the Overleaf connector.",
          );
        await fs.rm(target, { force: true });
        if (entry) {
          const content = await run(
            tx.worktree,
            ["cat-file", "blob", entry.hash],
            { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
          );
          await fs.writeFile(target, content, {
            mode: entry.mode === "100755" ? 0o755 : 0o644,
          });
        }
      }
      await run(tx.worktree, ["add", "--all", "--", `:(literal)${file}`]);
      const unresolved = (await conflictEntries(tx)).length;
      await update(projectId, tx, {
        stage: unresolved ? "conflicts" : "ready",
        compile: undefined,
      });
      return review(projectId, id);
    });
  }
  async function stagingProject(projectId, id) {
    const tx = await transaction(projectId, id);
    if (!["ready", "applied"].includes(tx.stage))
      throw new Error("Resolve conflicts before compiling the review.");
    return { folder: tx.worktree };
  }
  async function recordCompile(
    projectId,
    id,
    { ok, message = "", reviewToken },
  ) {
    return locked(projectId, async () => {
      const tx = await transaction(projectId, id);
      if (!["ready", "applied"].includes(tx.stage))
        throw new Error("Resolve conflicts before recording a compile result.");
      const current = await review(projectId, id);
      if (current.reviewToken !== reviewToken)
        throw new Error(
          "The review changed during compilation. Compile it again.",
        );
      await update(projectId, tx, {
        compile: {
          ok: !!ok,
          message: String(message).slice(0, 2000),
          at: new Date().toISOString(),
          reviewToken,
        },
      });
      return review(projectId, id);
    });
  }
  async function apply(projectId, id, expected = {}) {
    return locked(projectId, async () => {
      const item = await connection(projectId),
        tx = await transaction(projectId, id);
      if (tx.stage !== "ready")
        throw new Error("Resolve every conflict before applying this review.");
      if (
        expected.expectedHead !== tx.baseHead ||
        expected.expectedRemoteHead !== tx.remoteHead
      )
        throw new Error(
          "Review the current local and remote revisions before applying.",
        );
      await requireClean(item, tx.baseHead);
      if ((await fetchRemote(projectId, item)) !== tx.remoteHead)
        throw new Error(
          "Overleaf changed during review. Cancel and create a fresh review.",
        );
      const current = await review(projectId, id);
      if (!expected.reviewToken || current.reviewToken !== expected.reviewToken)
        throw new Error(
          "The reviewed contents changed. Refresh the preview before applying.",
        );
      if (current.files.some((entry) => entry.status === "??"))
        throw new Error(
          "The review folder contains new source files outside the reviewed revision. Start a new review with those files committed.",
        );
      await run(tx.worktree, ["diff", "--quiet"]);
      const tree = await run(tx.worktree, ["write-tree"]);
      const original = await run(tx.worktree, [
        "rev-parse",
        `${tx.remoteHead}^{tree}`,
      ]);
      let resultHead = tx.remoteHead;
      if (tree !== original) {
        const message = String(
          expected.message || "Review local manuscript changes for Overleaf",
        ).trim();
        if (!message || message.length > 1000)
          throw new Error("Use a commit message of 1 to 1000 characters.");
        resultHead = await run(tx.worktree, [
          "commit-tree",
          tree,
          "-p",
          tx.remoteHead,
          "-m",
          message,
        ]);
      }
      if (!oid(resultHead))
        throw new Error("The reviewed revision could not be created.");
      await run(item.folder, [
        "update-ref",
        `refs/research-overleaf/reviews/${id}`,
        resultHead,
      ]);
      await update(projectId, tx, {
        stage: "applying",
        resultHead,
        approvedReviewToken: current.reviewToken,
      });
      try {
        await requireClean(item, tx.baseHead);
        const branch = await run(item.folder, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "HEAD",
        ]);
        if (branch !== tx.branch)
          throw new Error("The manuscript branch changed during review.");
        // --keep rechecks overlapping disk edits inside Git. An external editor
        // racing the preflight must cause a rejection, never lose its changes.
        await run(item.folder, ["reset", "--keep", resultHead]);
        await update(projectId, tx, { stage: "applied" });
        return review(projectId, id);
      } catch (error) {
        await update(projectId, tx, {
          stage: (await head(item.folder)) === resultHead ? "applied" : "ready",
          error: error.message,
        });
        throw error;
      }
    });
  }
  async function publish(projectId, id, expected = {}) {
    return locked(projectId, async () => {
      const item = await connection(projectId),
        tx = await transaction(projectId, id);
      if (item.mode !== "publish")
        throw new Error(
          "This connection is in review-only mode. Enable publishing explicitly before sending changes to Overleaf.",
        );
      if (tx.stage !== "applied")
        throw new Error(
          "Apply and compile the reviewed revision before publishing.",
        );
      if (!expected.acknowledgeReviewDataLoss)
        throw new Error(
          "Acknowledge that source synchronization can displace Overleaf comments and tracked changes before publishing.",
        );
      if (
        expected.expectedHead !== tx.resultHead ||
        expected.expectedRemoteHead !== tx.remoteHead
      )
        throw new Error("The publish revisions do not match this review.");
      const current = await review(projectId, id);
      if (!tx.compile?.ok || tx.compile.reviewToken !== current.reviewToken)
        throw new Error(
          "Compile this exact reviewed manuscript successfully before publishing.",
        );
      if (current.reviewToken !== tx.approvedReviewToken)
        throw new Error(
          "The review changed after applying. Start a new review.",
        );
      await requireClean(item, tx.resultHead);
      await supportedTree(item.folder, tx.resultHead);
      if ((await fetchRemote(projectId, item)) !== tx.remoteHead)
        throw new Error(
          "Overleaf changed since review. Reconcile its new changes before publishing.",
        );
      await run(item.folder, [
        "merge-base",
        "--is-ancestor",
        tx.remoteHead,
        tx.resultHead,
      ]);
      await update(projectId, tx, { stage: "publishing", error: undefined });
      try {
        await request(
          item.folder,
          [
            "push",
            item.gitUrl,
            `${tx.resultHead}:refs/heads/${item.remoteBranch}`,
          ],
          item,
        );
        await run(item.folder, ["update-ref", remoteRef(item), tx.resultHead]);
        item.lastPublishedAt = new Date().toISOString();
        item.lastPublishedHead = tx.resultHead;
        await save(projectId, "connection", item);
        await update(projectId, tx, { stage: "published" });
        return publicTransaction(tx);
      } catch (error) {
        // A lost response may follow a successful push. Keep the journal pending;
        // Check verifies ancestry before permitting any retry.
        await update(projectId, tx, {
          error: `Publishing did not return a confirmed result. Check Overleaf before retrying. ${error.message}`,
        });
        throw new Error(tx.error);
      }
    });
  }
  async function cleanup(item, tx) {
    await run(item.folder, [
      "worktree",
      "remove",
      "--force",
      tx.worktree,
    ]).catch(async () => {
      await fs.rm(tx.worktree, { recursive: true, force: true });
      await run(item.folder, ["worktree", "prune"]);
    });
  }
  async function cancel(projectId, id) {
    return locked(projectId, async () => {
      const item = await connection(projectId),
        tx = await transaction(projectId, id);
      if (tx.stage === "publishing")
        throw new Error(
          "Check the outcome of the pending publish before cancelling.",
        );
      await cleanup(item, tx);
      await update(projectId, tx, { stage: "cancelled", error: undefined });
      return publicTransaction(tx);
    });
  }
  async function restore(projectId, id, { expectedHead } = {}) {
    return locked(projectId, async () => {
      const item = await connection(projectId),
        tx = await transaction(projectId, id);
      if (
        !["applied", "cancelled"].includes(tx.stage) ||
        !tx.resultHead ||
        expectedHead !== tx.resultHead
      )
        throw new Error(
          "Only a locally applied unpublished review can be restored.",
        );
      if (item.lastPublishedHead === tx.resultHead)
        throw new Error(
          "This revision was published. Review a new change instead of rewinding it.",
        );
      await requireClean(item, tx.resultHead);
      if (
        (await run(item.folder, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "HEAD",
        ])) !== tx.branch
      )
        throw new Error(
          "Return to the manuscript branch before restoring its checkpoint.",
        );
      await run(item.folder, ["reset", "--keep", tx.baseHead]);
      await cleanup(item, tx);
      await update(projectId, tx, { stage: "cancelled", restored: true });
      return status(projectId);
    });
  }
  async function setMode(projectId, mode) {
    return locked(projectId, async () => {
      if (!["review", "publish"].includes(mode))
        throw new Error("Choose review or publish mode.");
      const item = await connection(projectId);
      item.mode = mode;
      await save(projectId, "connection", item);
      return status(projectId);
    });
  }
  async function disconnect(projectId) {
    return locked(projectId, async () => {
      const item = await connection(projectId),
        tx = await recover(projectId, item, true);
      if (tx && !terminal.has(tx.stage))
        throw new Error(
          "Finish or cancel the current review before disconnecting.",
        );
      if (tx) await cleanup(item, tx);
      await credentials.remove(item.credentialRef);
      await fs.rm(location(projectId, "connection"), { force: true });
      await fs.rm(location(projectId, "transaction"), { force: true });
      return {
        connected: false,
        secureStorageAvailable: credentials.available(),
      };
    });
  }
  return {
    connect,
    replaceCredential,
    status,
    check,
    plan,
    review,
    resolve,
    stagingProject,
    recordCompile,
    apply,
    publish,
    cancel,
    restore,
    setMode,
    disconnect,
  };
}

module.exports = { createOverleaf, parseOverleafUrl };
