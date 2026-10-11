const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { atomicWrite, exists } = require("./core.cjs");
const {
  paperSnapshot,
  warnings: paperWarnings,
} = require("./paper-snapshot.cjs");
const { protectedWrite, AIError } = require("./chatgpt.cjs");
const execute = promisify(execFile);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const excluded = new Set([
  ".git",
  ".research-build",
  "node_modules",
  "build",
  "dist",
  "release",
  "vendor",
  "__pycache__",
  "target",
  "venv",
  ".venv",
  ".cache",
  ".next",
]);
const same = (a, b) =>
  (!a && !b) ||
  (!!a && !!b && a.hash === b.hash && a.mode === b.mode && a.type === b.type);
const reviewKey = (profileId, projectId, messageId) =>
  hash(JSON.stringify([profileId, projectId, messageId]));
const folderKey = (item) => item.root + "\0" + item.relative;
// Older runs kept every folder listing; newer ones keep only the folders the
// run created, which is all a revert removes.
function createdDirectories(value) {
  if (value.createdDirectories) return value.createdDirectories;
  const original = new Set((value.before?.directories || []).map(folderKey));
  return (value.after?.directories || []).filter(
    (item) => !original.has(folderKey(item)),
  );
}
const statKey = (stat) =>
  [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino, stat.mode].join(":");

function createChangeStore(
  directory,
  {
    maxFileBytes = 8 * 1024 * 1024,
    maxSnapshotBytes = 128 * 1024 * 1024,
    replace = atomicWrite,
  } = {},
) {
  const manifests = path.join(directory, "runs");
  const blobs = path.join(directory, "blobs");
  const locks = new Set();
  // Versions from each root's last capture, by file. A file whose size,
  // times, inode and mode still match is not read and hashed again. The index
  // keeps them across restarts.
  const known = new Map();
  const indexFile = path.join(directory, "index.json");
  const listOrEmpty = (folder) =>
    fs
      .readdir(folder)
      .catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
  // Captures, reviews and restores wait while unused versions are deleted.
  let collecting = null;
  const collected = () => collecting?.catch(() => {});
  function manifestFile(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid change snapshot.");
    return path.join(manifests, id + ".json");
  }
  const save = (id, value) =>
    protectedWrite(manifestFile(id), JSON.stringify(value));
  const load = async (id) =>
    JSON.parse(await fs.readFile(manifestFile(id), "utf8"));
  const blobFile = (digest) => {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new Error("Invalid file snapshot.");
    return path.join(blobs, digest);
  };
  async function readBlob(entry) {
    if (!entry || entry.type !== "file") return null;
    if (entry.unavailable)
      throw new AIError("revert_unavailable", entry.unavailable);
    const bytes = await fs.readFile(blobFile(entry.hash)).catch(() => {
      throw new AIError(
        "snapshot_storage_error",
        "A saved file version could not be read. Project files have been preserved. Check file access and restore your app data backup if necessary.",
      );
    });
    if (hash(bytes) !== entry.hash)
      throw new AIError(
        "snapshot_storage_error",
        "The saved file version is damaged. Its data has been preserved.",
      );
    return bytes;
  }
  async function safeTarget(root, relative, create = false) {
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative
        .split(path.sep)
        .some((part) => part === ".." || excluded.has(part))
    )
      throw new Error(
        "File changes must stay inside the original project folders.",
      );
    if ((await fs.realpath(root)) !== root)
      throw new Error("The original project folder has moved.");
    const parts = relative.split(path.sep);
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (create)
        await fs.mkdir(parent).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
      const stat = await fs.lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("A parent folder was replaced. Restore stopped.");
    }
    return path.join(parent, parts.at(-1));
  }
  // With `capture` ({ budget, seen }), the version is also stored for revert.
  async function entryAt(root, relative, capture) {
    let file;
    try {
      file = await safeTarget(root, relative);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const link = await fs.readlink(file);
      return {
        root,
        relative,
        type: "link",
        link,
        hash: hash("link:" + link),
        mode: 0,
        size: Buffer.byteLength(link),
      };
    }
    if (!stat.isFile())
      throw new Error(
        "A changed path is no longer a regular file: " + relative,
      );
    const entry = {
      root,
      relative,
      type: "file",
      mode: stat.mode & 0o777,
      size: stat.size,
    };
    if (
      stat.size > maxFileBytes ||
      (capture && capture.budget.bytes + stat.size > maxSnapshotBytes)
    ) {
      return {
        ...entry,
        hash: hash(JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs])),
        unavailable: "This file exceeded the snapshot size limit.",
      };
    }
    // A cached version's blob exists: collect keeps every indexed version.
    const cached = capture && known.get(root)?.get(relative);
    if (cached?.key === statKey(stat)) {
      capture.budget.bytes += stat.size;
      capture.seen.set(relative, cached);
      return cached.entry;
    }
    let bytes, after;
    // A file that keeps changing, such as a log, cannot be restored exactly.
    for (let attempt = 0; !bytes; attempt++) {
      if (attempt === 3)
        return {
          ...entry,
          hash: hash(JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs])),
          unavailable: "This file kept changing while it was being saved.",
        };
      const handle = await fs.open(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const before = await handle.stat();
        const read = await handle.readFile();
        after = await handle.stat();
        if (statKey(before) === statKey(after)) bytes = read;
      } finally {
        await handle.close();
      }
    }
    entry.size = bytes.length;
    entry.hash = hash(bytes);
    entry.binary =
      bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes);
    if (capture) {
      capture.budget.bytes += bytes.length;
      const target = blobFile(entry.hash);
      if (!(await exists(target))) await protectedWrite(target, bytes);
      // Coarse timestamps on some volumes miss edits made within a second or
      // two, so recently modified files are read again next time.
      if (Date.now() - after.mtimeMs > 3000)
        capture.seen.set(relative, { key: statKey(after), entry });
    }
    return entry;
  }
  // Callers wait for collect first, except startup recovery inside collect.
  async function capture(roots) {
    const entries = {},
      directories = [];
    const budget = { bytes: 0 };
    for (const root of roots) {
      const seen = new Map();
      const pending = [""];
      while (pending.length) {
        const relative = pending.shift();
        const folder = relative
          ? await safeTarget(root, relative + path.sep + "_")
          : root;
        // safeTarget above validates the directory; readdir needs its parent.
        const listing = await fs.readdir(
          relative ? path.dirname(folder) : folder,
          { withFileTypes: true },
        );
        for (const item of listing) {
          if (excluded.has(item.name)) continue;
          const name = path.join(relative, item.name);
          if (item.isDirectory()) {
            directories.push({ root, relative: name });
            pending.push(name);
          } else if (item.isFile() || item.isSymbolicLink()) {
            const entry = await entryAt(root, name, { budget, seen });
            if (entry) entries[hash(root + "\0" + name)] = entry;
          }
        }
      }
      known.set(root, seen);
    }
    await protectedWrite(
      indexFile,
      JSON.stringify([...known].map(([root, seen]) => [root, [...seen]])),
    );
    return { entries, directories };
  }
  const fingerprint = (snapshot, roots, legacyRoots) =>
    hash(
      JSON.stringify(
        Object.values(snapshot.entries)
          .map((e) => {
            const rootIndex = roots.indexOf(e.root);
            const identity = legacyRoots
              ? hash(legacyRoots[rootIndex] + "\0" + e.relative)
              : JSON.stringify([rootIndex, e.relative]);
            return [identity, e.hash, e.mode, e.type, e.unavailable];
          })
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  async function capturePaper(project) {
    const { bytes, ...metadata } = await paperSnapshot(project);
    if (!bytes) return metadata;
    const digest = hash(bytes);
    await protectedWrite(blobFile(digest), bytes);
    return { ...metadata, hash: digest, size: bytes.length };
  }
  async function begin(id, folders, manuscript) {
    const canonical = [
      ...new Set(
        await Promise.all(folders.map((folder) => fs.realpath(folder))),
      ),
    ].sort();
    const roots = canonical.filter(
      (root) =>
        !canonical.some(
          (other) => other !== root && root.startsWith(other + path.sep),
        ),
    );
    await collected();
    const before = await capture(roots);
    await save(id, {
      version: 1,
      roots,
      before,
      ...(manuscript
        ? { manuscript, paper: { before: await capturePaper(manuscript) } }
        : {}),
      createdAt: new Date().toISOString(),
    });
  }
  async function finish(id) {
    await collected();
    return complete(id);
  }
  // `interrupted`: saved at the next launch, so the final versions can
  // include edits made after the app closed.
  async function complete(id, interrupted = false) {
    const { before, ...value } = await load(id);
    const after = await capture(value.roots);
    if (interrupted) value.interrupted = true;
    value.changes = [
      ...new Set([
        ...Object.keys(before.entries),
        ...Object.keys(after.entries),
      ]),
    ]
      .filter((key) => !same(before.entries[key], after.entries[key]))
      .map((key) => ({
        id: key,
        before: before.entries[key] || null,
        after: after.entries[key] || null,
      }));
    // Review and revert need only the changed files, not the full listings.
    value.createdDirectories = createdDirectories({ before, after });
    value.fingerprintVersion = 2;
    value.afterFingerprint = fingerprint(after, value.roots);
    if (value.manuscript)
      value.paper = {
        ...value.paper,
        after: await capturePaper(value.manuscript),
      };
    await save(id, value);
    return { files: value.changes.length };
  }
  // The review record for a run that was interrupted before it finished.
  async function summary(id) {
    await collected();
    const value = await load(id).catch(() => null);
    return value?.changes
      ? { files: value.changes.length, interrupted: !!value.interrupted }
      : null;
  }
  // Removes the runs of a deleted chat; their versions go at the next collect.
  async function discard(ids) {
    for (const id of ids) await fs.rm(manifestFile(id), { force: true });
  }
  // Finishes runs a closed app left open, deletes saved versions that no run
  // or cached capture needs, shrinks older run records, and drops captures
  // that can no longer be finished. Runs before any capture.
  function collect() {
    collecting = (async () => {
      // A damaged index is only a lost cache.
      const index = await fs
        .readFile(indexFile, "utf8")
        .then(JSON.parse)
        .then((data) => (Array.isArray(data) ? data : []))
        .catch(() => []);
      const needed = new Set();
      for (const [, files] of index)
        for (const [, { entry }] of files) needed.add(entry.hash);
      for (const name of await listOrEmpty(manifests)) {
        const id = path.basename(name, ".json");
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        // An unreadable run might need any version, so nothing is deleted.
        let value = await load(id);
        // A run the app never finished, after a crash, force quit or the quit
        // time limit, gets its current files as final versions so Review and
        // Revert keep working. Nothing else runs this early.
        if (!value.changes)
          value = await complete(id, true).then(
            () => load(id),
            () => value,
          );
        if (!value.changes) {
          if (value.paper?.before?.hash) needed.add(value.paper.before.hash);
          const { mtimeMs } = await fs.stat(manifestFile(id));
          if (Date.now() - mtimeMs > 60 * 60 * 1000) {
            await fs.rm(manifestFile(id), { force: true });
            continue;
          }
          for (const entry of Object.values(value.before?.entries || {}))
            needed.add(entry.hash);
          continue;
        }
        for (const version of [value.paper?.before, value.paper?.after])
          if (version?.hash) needed.add(version.hash);
        for (const change of value.changes)
          for (const entry of [change.before, change.after])
            if (entry?.type === "file") needed.add(entry.hash);
        if (value.before) {
          const { before, after, ...slim } = value;
          slim.createdDirectories = createdDirectories(value);
          await save(id, slim);
        }
      }
      const stored = new Set(await listOrEmpty(blobs));
      for (const digest of stored)
        if (/^[a-f0-9]{64}$/.test(digest) && !needed.has(digest))
          await fs.rm(path.join(blobs, digest), { force: true });
      // Only versions still on disk may stand in for a read.
      known.clear();
      for (const [root, files] of index)
        known.set(
          root,
          new Map(files.filter(([, { entry }]) => stored.has(entry.hash))),
        );
    })().finally(() => {
      collecting = null;
    });
    return collecting;
  }
  async function check(value, allowedRoots) {
    if (value.revertedAt) return "These changes have already been reverted.";
    if (!value.changes)
      return "This run ended before its final file versions were saved.";
    if (!value.changes.length)
      return "This run did not change any project files.";
    const allowed = await Promise.all(
      allowedRoots.map((root) => fs.realpath(root).catch(() => null)),
    );
    for (const change of value.changes) {
      if (change.revertedAt) continue;
      const entry = change.after || change.before;
      if (
        !allowed.some(
          (root) =>
            root &&
            (entry.root === root || entry.root.startsWith(root + path.sep)),
        )
      )
        return "The original project folder is no longer attached.";
      const unavailable =
        change.before?.unavailable || change.after?.unavailable;
      if (unavailable)
        return `${entry.relative}: ${unavailable} Automatic revert is unavailable.`;
      try {
        const current = await entryAt(entry.root, entry.relative);
        if (
          !same(current, change.after) &&
          !(
            value.reverting &&
            (!value.revertingIds || value.revertingIds.includes(change.id)) &&
            same(current, change.before)
          )
        )
          return (
            entry.relative +
            " changed after this run. Your newer edits will be preserved."
          );
      } catch {
        return (
          entry.relative +
          " is unavailable or its parent folder changed. Restore stopped."
        );
      }
    }
    return "";
  }
  function fileInfo(change) {
    const entry = change.after || change.before;
    return {
      id: change.id,
      revertedAt: change.revertedAt,
      path: entry.relative,
      absolutePath: path.join(entry.root, entry.relative),
      folder: path.basename(entry.root),
      kind: !change.before ? "added" : !change.after ? "deleted" : "modified",
      binary: !!(change.before?.binary || change.after?.binary),
      beforeBytes: change.before?.size || 0,
      afterBytes: change.after?.size || 0,
      beforeMode: change.before?.mode,
      afterMode: change.after?.mode,
      snapshot:
        change.before?.unavailable || change.after?.unavailable
          ? false
          : undefined,
    };
  }
  async function review(id, allowedRoots) {
    await collected();
    const value = await load(id);
    const reason = await check(value, allowedRoots);
    return {
      files: await Promise.all(
        (value.changes || []).map(async (change) => {
          const reason = change.revertedAt
            ? "This file was already reverted."
            : await check({ ...value, changes: [change] }, allowedRoots);
          return {
            ...fileInfo(change),
            revertedAt: change.revertedAt || value.revertedAt,
            canRevert: !reason,
            reason,
          };
        }),
      ),
      canRevert: !reason,
      reason,
      revertedAt: value.revertedAt,
      interrupted: !!value.interrupted,
      warnings: [
        ...(value.interrupted
          ? [
              "The app closed before this run finished. Its final versions were saved at the next launch and can include edits made in between.",
            ]
          : []),
        "Generated folders, dependencies, and Git history are excluded.",
      ],
    };
  }
  async function validatePaperBuild(id, allowedRoots, manuscript) {
    await collected();
    const value = await load(id);
    if (
      !value.manuscript ||
      value.manuscript.folder !== manuscript.folder ||
      value.manuscript.mainFile !== manuscript.mainFile
    )
      throw new AIError(
        "paper_verification_blocked",
        "This run used a different manuscript. Review its saved PDFs instead.",
      );
    if (
      value.interrupted ||
      value.revertedAt ||
      value.changes?.some((item) => item.revertedAt)
    )
      throw new AIError(
        "paper_verification_blocked",
        "This run was interrupted or reverted. Review its saved PDFs instead.",
      );
    const allowed = await Promise.all(
      allowedRoots.map((root) => fs.realpath(root)),
    );
    if (value.roots.some((root) => !allowed.includes(root)))
      throw new AIError(
        "paper_verification_blocked",
        "The project folders have changed.",
      );
    const current = await capture(value.roots);
    if (
      !value.afterFingerprint ||
      Object.values(current.entries).some((entry) => entry.unavailable) ||
      fingerprint(
        current,
        value.roots,
        value.fingerprintVersion === 2
          ? undefined
          : value.fingerprintRoots || value.roots,
      ) !== value.afterFingerprint
    )
      throw new AIError(
        "paper_verification_blocked",
        "Project files changed after this run. Compile from the workbench; this run's saved review stays unchanged.",
      );
  }
  async function recordPaperBuild(id, result) {
    const value = await load(id);
    value.paper = {
      ...value.paper,
      after: await capturePaper(value.manuscript),
      build: {
        ok: result.ok,
        log: String(result.log || "").slice(-100000),
        warnings: paperWarnings(result.log),
        at: new Date().toISOString(),
      },
    };
    await save(id, value);
  }
  async function paper(id) {
    await collected();
    const value = await load(id);
    const result = {
      ...value.paper,
      interrupted: !!value.interrupted,
      canVerify:
        !!value.manuscript?.folder &&
        !!value.manuscript?.mainFile &&
        !!value.afterFingerprint &&
        !value.interrupted &&
        !value.revertedAt &&
        !value.changes?.some((item) => item.revertedAt),
      note: !value.paper
        ? "This older run has no saved PDF snapshots."
        : undefined,
    };
    for (const side of ["before", "after"]) {
      const version = value.paper?.[side];
      if (version?.hash) {
        const bytes = await readBlob({ ...version, type: "file" });
        result[side] = { ...version, data: bytes };
      }
    }
    return result;
  }
  async function file(id, fileId) {
    await collected();
    const value = await load(id);
    const change = value.changes?.find((item) => item.id === fileId);
    if (!change) throw new Error("This file is not part of the selected run.");
    const info = fileInfo(change);
    const unavailable = change.before?.unavailable || change.after?.unavailable;
    if (unavailable)
      return { ...info, diff: `File versions are unavailable. ${unavailable}` };
    const beforeBytes =
      change.before?.type === "link"
        ? Buffer.from("Symbolic link: " + change.before.link + "\n")
        : await readBlob(change.before);
    const afterBytes =
      change.after?.type === "link"
        ? Buffer.from("Symbolic link: " + change.after.link + "\n")
        : await readBlob(change.after);
    if (info.binary)
      return {
        ...info,
        diff: "Binary file changed. Revert restores the exact original bytes.",
      };
    const temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), "research-review-"),
    );
    let diff = "",
      truncated = false;
    try {
      const beforeFile = path.join(temporary, "before"),
        afterFile = path.join(temporary, "after");
      await fs.writeFile(beforeFile, beforeBytes || "");
      await fs.writeFile(afterFile, afterBytes || "");
      try {
        diff = (
          await execute(
            "/usr/bin/git",
            [
              "diff",
              "--no-index",
              "--no-ext-diff",
              "--no-textconv",
              "--no-color",
              "--",
              beforeFile,
              afterFile,
            ],
            { timeout: 10000, maxBuffer: 1024 * 1024 },
          )
        ).stdout;
      } catch (error) {
        if (
          error.code !== 1 &&
          error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        )
          return {
            ...info,
            before: beforeBytes?.toString("utf8").slice(0, 250000),
            after: afterBytes?.toString("utf8").slice(0, 250000),
            diff: "Diff preview could not be generated. Use Before & after to review the saved file versions.",
            truncated:
              (beforeBytes?.length || 0) > 250000 ||
              (afterBytes?.length || 0) > 250000,
          };
        diff = error.stdout || "";
        truncated = error.code !== 1;
      }
      diff = diff.slice(
        diff.indexOf("@@") < 0 ? diff.length : diff.indexOf("@@"),
      );
      const limit = 250000;
      const before = beforeBytes?.toString("utf8"),
        after = afterBytes?.toString("utf8");
      return {
        ...info,
        before: before?.slice(0, limit),
        after: after?.slice(0, limit),
        diff: diff.slice(0, limit),
        truncated:
          truncated ||
          diff.length > limit ||
          (before?.length || 0) > limit ||
          (after?.length || 0) > limit,
      };
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  async function writeVersion(root, relative, entry) {
    const target = await safeTarget(root, relative, !!entry);
    if (!entry) {
      await fs.unlink(target);
      return;
    }
    if (entry.type === "link") {
      const temporary = target + "." + crypto.randomUUID() + ".tmp";
      try {
        await fs.symlink(entry.link, temporary);
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    } else {
      await replace(target, await readBlob(entry), { mode: entry.mode });
      await fs.chmod(target, entry.mode);
    }
  }
  async function revert(id, allowedRoots, fileIds) {
    await collected();
    if (locks.has(id))
      throw new Error("These changes are already being restored.");
    locks.add(id);
    const written = [];
    let value;
    let original;
    let journalWritten = false;
    try {
      value = await load(id);
      original = structuredClone(value);
      const ids =
        fileIds === undefined
          ? value.revertingIds ||
            (value.changes || []).filter((c) => !c.revertedAt).map((c) => c.id)
          : fileIds;
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.some((id) => typeof id !== "string") ||
        new Set(ids).size !== ids.length ||
        ids.some(
          (id) => !value.changes?.some((c) => c.id === id && !c.revertedAt),
        )
      )
        throw new AIError(
          "revert_blocked",
          "Choose files from this run that have not already been reverted.",
        );
      if (
        value.revertingIds &&
        (ids.length !== value.revertingIds.length ||
          ids.some((id) => !value.revertingIds.includes(id)))
      )
        throw new AIError(
          "revert_blocked",
          "Finish the interrupted file restore before selecting other files.",
        );
      const selected = value.changes.filter((change) =>
        ids.includes(change.id),
      );
      const reason = await check({ ...value, changes: selected }, allowedRoots);
      if (reason) throw new AIError("revert_blocked", reason);
      // Validate every backup before touching any project file.
      for (const change of selected) {
        await readBlob(change.before);
        await readBlob(change.after);
      }
      value.reverting = true;
      value.revertingIds = ids;
      await save(id, value);
      journalWritten = true;
      for (const change of selected) {
        const entry = change.after || change.before;
        const current = await entryAt(entry.root, entry.relative);
        if (same(current, change.before)) continue;
        if (!same(current, change.after))
          throw new AIError(
            "revert_blocked",
            entry.relative +
              " changed during restore. Your newer edits were preserved.",
          );
        written.push(change);
        await writeVersion(entry.root, entry.relative, change.before);
      }
      const revertedAt = new Date().toISOString();
      for (const change of selected) change.revertedAt = revertedAt;
      if (value.changes.every((change) => change.revertedAt))
        value.revertedAt = revertedAt;
      delete value.reverting;
      delete value.revertingIds;
      await save(id, value);
      for (const item of [...createdDirectories(value)].sort(
        (a, b) => b.relative.length - a.relative.length,
      ))
        await safeTarget(item.root, item.relative)
          .then((folder) => fs.rmdir(folder))
          .catch(() => {});
      return {
        files: selected.length,
        revertedAt: value.revertedAt,
        revertedFiles: value.changes.filter((c) => c.revertedAt).length,
      };
    } catch (error) {
      let recovered = true;
      for (const change of written.reverse()) {
        const entry = change.after || change.before;
        try {
          const current = await entryAt(entry.root, entry.relative);
          if (same(current, change.after)) continue;
          if (!same(current, change.before)) {
            recovered = false;
            continue;
          }
          await writeVersion(entry.root, entry.relative, change.after);
        } catch {
          recovered = false;
        }
      }
      if (original && recovered && journalWritten)
        await save(id, original).catch(() => {
          recovered = false;
        });
      if (!recovered)
        throw new AIError(
          "revert_incomplete",
          "Restore stopped before completion. Saved versions were preserved; review the files and retry.",
        );
      if (error instanceof AIError) throw error;
      throw new AIError(
        "revert_failed",
        "Files could not be restored. Saved versions were preserved. Check disk space and file access, then retry.",
      );
    } finally {
      locks.delete(id);
    }
  }
  return {
    begin,
    finish,
    summary,
    discard,
    collect,
    review,
    file,
    revert,
    paper,
    validatePaperBuild,
    recordPaperBuild,
  };
}
// Older conversations saved patches but no original bytes. Keep them reviewable
// without implying that their changes can be restored.
function legacyReview(message) {
  const reason =
    message.review?.unavailable ||
    "This older run has no saved file versions. You can review its patch, but automatic revert is unavailable.";
  const patches =
    message.diff?.split(/(?=^diff --git )/m).filter((part) => part.trim()) ||
    [];
  const files = patches.map((diff, index) => {
    const names =
      /^\+\+\+ (?:b\/)?(.+)$/m.exec(diff) || /^--- (?:a\/)?(.+)$/m.exec(diff);
    const name =
      names?.[1] === "/dev/null"
        ? /^--- (?:a\/)?(.+)$/m.exec(diff)?.[1]
        : names?.[1];
    return { id: "legacy-" + index, path: name || "Saved patch", diff };
  });
  if (!files.length) {
    for (const activity of message.activities || []) {
      for (const change of activity.changes || []) {
        const existing = files.find((item) => item.path === change.path);
        if (existing) existing.diff += "\n" + change.diff;
        else
          files.push({
            id: "legacy-" + files.length,
            path: change.path,
            diff: change.diff || "",
          });
      }
    }
  }
  for (const file of files)
    Object.assign(file, {
      kind: /^--- \/dev\/null$/m.test(file.diff)
        ? "added"
        : /^\+\+\+ \/dev\/null$/m.test(file.diff)
          ? "deleted"
          : "modified",
      folder: "",
      binary: false,
      beforeBytes: 0,
      afterBytes: 0,
      snapshot: false,
    });
  return {
    files,
    review: {
      files: files.map(({ diff, ...info }) => info),
      canRevert: false,
      reason,
      warnings: [reason],
    },
  };
}
module.exports = { createChangeStore, reviewKey, legacyReview };
