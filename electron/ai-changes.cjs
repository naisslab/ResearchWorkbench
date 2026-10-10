const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { atomicWrite } = require("./core.cjs");
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
  async function entryAt(root, relative, budget = { bytes: 0 }, store = false) {
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
      (store && budget.bytes + stat.size > maxSnapshotBytes)
    ) {
      return {
        ...entry,
        hash: hash(JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs])),
        unavailable: "This file exceeded the snapshot size limit.",
      };
    }
    const handle = await fs.open(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    let bytes;
    try {
      const before = await handle.stat();
      bytes = await handle.readFile();
      const after = await handle.stat();
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error(
          "A file changed while its version was being saved: " + relative,
        );
    } finally {
      await handle.close();
    }
    entry.hash = hash(bytes);
    entry.binary =
      bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes);
    if (store) {
      budget.bytes += bytes.length;
      const target = blobFile(entry.hash);
      if (
        !(await fs.access(target).then(
          () => true,
          () => false,
        ))
      )
        await protectedWrite(target, bytes);
    }
    return entry;
  }
  async function capture(roots) {
    const entries = {},
      directories = [];
    const budget = { bytes: 0 };
    for (const root of roots) {
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
            const entry = await entryAt(root, name, budget, true);
            if (entry) entries[hash(root + "\0" + name)] = entry;
          }
        }
      }
    }
    return { entries, directories };
  }
  async function begin(id, folders) {
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
    const before = await capture(roots);
    await save(id, {
      version: 1,
      roots,
      before,
      createdAt: new Date().toISOString(),
    });
  }
  async function finish(id) {
    const value = await load(id);
    value.after = await capture(value.roots);
    value.changes = [
      ...new Set([
        ...Object.keys(value.before.entries),
        ...Object.keys(value.after.entries),
      ]),
    ]
      .filter(
        (key) => !same(value.before.entries[key], value.after.entries[key]),
      )
      .map((key) => ({
        id: key,
        before: value.before.entries[key] || null,
        after: value.after.entries[key] || null,
      }));
    await save(id, value);
    return { files: value.changes.length };
  }
  async function check(value, allowedRoots) {
    if (value.revertedAt) return "These changes have already been reverted.";
    if (!value.after)
      return "This run ended before its final file versions were saved.";
    if (!value.changes.length)
      return "This run did not change any project files.";
    const allowed = await Promise.all(
      allowedRoots.map((root) => fs.realpath(root).catch(() => null)),
    );
    for (const change of value.changes) {
      const entry = change.after || change.before;
      if (
        !allowed.some(
          (root) =>
            root &&
            (entry.root === root || entry.root.startsWith(root + path.sep)),
        )
      )
        return "The original project folder is no longer attached.";
      if (change.before?.unavailable || change.after?.unavailable)
        return "A changed file exceeded the snapshot size limit; automatic revert is unavailable.";
      try {
        const current = await entryAt(entry.root, entry.relative);
        if (
          !same(current, change.after) &&
          !(value.reverting && same(current, change.before))
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
    const value = await load(id);
    const reason = await check(value, allowedRoots);
    return {
      files: (value.changes || []).map(fileInfo),
      canRevert: !reason,
      reason,
      revertedAt: value.revertedAt,
      warnings: [
        "Generated folders, dependencies, and Git history are excluded.",
      ],
    };
  }
  async function file(id, fileId) {
    const value = await load(id);
    const change = value.changes?.find((item) => item.id === fileId);
    if (!change) throw new Error("This file is not part of the selected run.");
    const info = fileInfo(change);
    if (change.before?.unavailable || change.after?.unavailable)
      return {
        ...info,
        diff: "File versions are unavailable because this file exceeded the snapshot size limit.",
      };
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
  async function revert(id, allowedRoots) {
    if (locks.has(id))
      throw new Error("These changes are already being restored.");
    locks.add(id);
    const written = [];
    let value;
    let wasReverting = false;
    try {
      value = await load(id);
      wasReverting = !!value.reverting;
      const reason = await check(value, allowedRoots);
      if (reason) throw new AIError("revert_blocked", reason);
      // Validate every backup before touching any project file.
      for (const change of value.changes) {
        await readBlob(change.before);
        await readBlob(change.after);
      }
      value.reverting = true;
      await save(id, value);
      for (const change of value.changes) {
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
      value.revertedAt = new Date().toISOString();
      delete value.reverting;
      await save(id, value);
      const original = new Set(
        value.before.directories.map(
          (item) => item.root + "\0" + item.relative,
        ),
      );
      for (const item of [...value.after.directories].sort(
        (a, b) => b.relative.length - a.relative.length,
      )) {
        if (!original.has(item.root + "\0" + item.relative))
          await safeTarget(item.root, item.relative)
            .then((folder) => fs.rmdir(folder))
            .catch(() => {});
      }
      return { files: value.changes.length, revertedAt: value.revertedAt };
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
      if (value && recovered && written.length) {
        if (wasReverting) value.reverting = true;
        else delete value.reverting;
        delete value.revertedAt;
        await save(id, value).catch(() => {});
      }
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
  return { begin, finish, review, file, revert };
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
