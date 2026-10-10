const fs = require("node:fs/promises");
const path = require("node:path");
const { createReadStream } = require("node:fs");
async function hashFile(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
const crypto = require("node:crypto");
const { atomicWrite, validateState } = require("./core.cjs");
const allowed = [
  "workspace.json",
  "pdf-annotations",
  "ai/conversations",
  "ai/chats",
  "ai/changes",
];
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
const within = (parent, child) =>
  child === parent || child.startsWith(parent + path.sep);
const isAllowed = (relative) =>
  allowed.some((item) => relative === item || relative.startsWith(item + "/"));
const safeRelative = (relative) =>
  typeof relative === "string" &&
  relative.length > 0 &&
  !path.isAbsolute(relative) &&
  relative
    .split("/")
    .every(
      (part) => part && part !== "." && part !== ".." && !part.includes("\\"),
    );
async function walk(folder, callback, prefix = "") {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      await walk(path.join(folder, entry.name), callback, relative);
    else await callback(path.join(folder, entry.name), relative, entry);
  }
}
async function createBackup({
  directory,
  destination,
  workspace,
  includeProjects = true,
  ui = {},
  signal,
  progress = () => {},
}) {
  const root = await fs.realpath(destination);
  if (within(await fs.realpath(directory), root))
    throw new Error(
      "Choose a backup location outside the application's data folder.",
    );
  const bundle = path.join(
    root,
    `Research-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`,
  );
  const manifest = {
    format: "research-workbench-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    files: [],
    folders: [],
    skipped: [],
    includeProjects,
  };
  await fs.mkdir(bundle, { mode: 0o700 });
  let bytes = 0;
  async function copy(source, relative, entry) {
    signal?.throwIfAborted();
    if (entry && !entry.isFile()) {
      manifest.skipped.push(`${source}: symbolic link or special file`);
      return;
    }
    if (manifest.files.length >= 100000)
      throw new Error(
        "Backup exceeds 100,000 files. Export without project folders or select a smaller workspace.",
      );
    const before = await fs.lstat(source);
    if (!before.isFile())
      throw new Error(`Backup source is not a regular file: ${source}`);
    const target = path.join(bundle, relative);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.copyFile(source, target);
    signal?.throwIfAborted();
    const after = await fs.lstat(source);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    )
      throw new Error(
        `File changed during backup: ${source}. Try again when its writer has finished.`,
      );
    await fs.chmod(target, before.mode & 0o777);
    const checksum = await hashFile(target);
    bytes += after.size;
    manifest.files.push({
      path: relative,
      bytes: after.size,
      sha256: checksum,
      mode: before.mode & 0o777,
    });
    progress({ files: manifest.files.length, bytes, current: relative });
  }
  async function generated(relative, value) {
    const file = path.join(bundle, relative),
      data = JSON.stringify(value, null, 2);
    await atomicWrite(file, data, { mode: 0o600 });
    manifest.files.push({
      path: relative,
      bytes: Buffer.byteLength(data),
      sha256: hash(data),
      mode: 0o600,
    });
    bytes += Buffer.byteLength(data);
  }
  try {
    signal?.throwIfAborted();
    await generated("app/workspace.json", validateState(workspace));
    await generated("ui.json", ui);
    for (const item of allowed.slice(1)) {
      const source = path.join(directory, item);
      if (!(await fs.stat(source).catch(() => null))) continue;
      await walk(source, (file, relative, entry) =>
        copy(file, `app/${item}/${relative}`, entry),
      );
    }
    if (includeProjects) {
      const roots = new Map();
      for (const project of workspace.projects) {
        for (const folder of [
          project.folder,
          ...(project.localFolders || []).map((root) => root.folder),
        ].filter(Boolean)) {
          const canonical = await fs.realpath(folder).catch(() => null);
          if (!canonical) {
            manifest.skipped.push(`${folder}: folder unavailable`);
            continue;
          }
          if (within(canonical, bundle))
            throw new Error(
              "Choose a backup location outside every attached project folder.",
            );
          if (!roots.has(canonical))
            roots.set(canonical, `projects/${roots.size + 1}`);
          manifest.folders.push({
            original: folder,
            canonical,
            path: roots.get(canonical),
          });
        }
      }
      for (const [source, relative] of roots) {
        await fs.mkdir(path.join(bundle, relative), { recursive: true });
        await walk(source, (file, name, entry) =>
          copy(file, `${relative}/${name}`, entry),
        );
      }
    }
    signal?.throwIfAborted();
    manifest.bytes = bytes;
    await atomicWrite(
      path.join(bundle, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
    return { path: bundle, ...manifest };
  } catch (error) {
    await fs.rm(bundle, { recursive: true, force: true });
    throw error;
  }
}
async function inspectBackup(bundle) {
  const base = await fs.realpath(bundle);
  const manifest = JSON.parse(
    await fs.readFile(path.join(base, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== "research-workbench-backup" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100000 ||
    !Array.isArray(manifest.folders)
  )
    throw new Error("Invalid Research Workbench backup.");
  const seen = new Set();
  for (const item of manifest.files) {
    if (
      !safeRelative(item.path) ||
      seen.has(item.path) ||
      !(
        item.path === "ui.json" ||
        (item.path.startsWith("app/") && isAllowed(item.path.slice(4))) ||
        /^projects\/\d+\//.test(item.path)
      )
    )
      throw new Error("Invalid backup file path.");
    seen.add(item.path);
    const file = await fs.realpath(path.join(base, item.path));
    if (
      !within(base, file) ||
      (await fs.lstat(path.join(base, item.path))).isSymbolicLink()
    )
      throw new Error("Backup contains an unsafe link.");
    const stat = await fs.stat(file);
    if (
      !stat.isFile() ||
      stat.size !== item.bytes ||
      (await hashFile(file)) !== item.sha256
    )
      throw new Error(`Backup verification failed: ${item.path}`);
  }
  if (!seen.has("app/workspace.json"))
    throw new Error("Backup is missing its workspace.");
  for (const folder of manifest.folders)
    if (
      !/^projects\/\d+$/.test(folder.path) ||
      typeof folder.original !== "string" ||
      !path.isAbsolute(folder.original) ||
      typeof folder.canonical !== "string" ||
      !path.isAbsolute(folder.canonical)
    )
      throw new Error("Invalid folder mapping.");
  const workspace = validateState(
    JSON.parse(
      await fs.readFile(path.join(base, "app/workspace.json"), "utf8"),
    ),
  );
  const ui = seen.has("ui.json")
    ? JSON.parse(await fs.readFile(path.join(base, "ui.json"), "utf8"))
    : {};
  if (
    !ui ||
    typeof ui !== "object" ||
    Array.isArray(ui) ||
    Object.entries(ui).some(
      ([key, value]) =>
        !key.startsWith("research-workbench.") ||
        typeof value !== "string" ||
        value.length > 5 * 1024 * 1024,
    )
  )
    throw new Error("Invalid saved interface state.");
  return { manifest, workspace, ui, base };
}
async function restoreBackup({
  bundle,
  directory,
  destination,
  bindProfileId,
}) {
  const { manifest, workspace, ui, base } = await inspectBackup(bundle);
  const root = await fs.realpath(destination);
  if (within(base, root) || within(await fs.realpath(directory), root))
    throw new Error(
      "Choose a restoration folder outside the backup and application data.",
    );
  const restored = path.join(
    root,
    `Restored-research-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  );
  const stage = await fs.mkdtemp(path.join(directory, ".restore-stage-"));
  const rollback = await fs.mkdtemp(path.join(directory, ".before-restore-"));
  const mappings = new Map(
    manifest.folders.flatMap((folder) => [
      [folder.original, path.join(restored, folder.path)],
      [folder.canonical, path.join(restored, folder.path)],
    ]),
  );
  const remapPath = (value) => {
    for (const [old, next] of [...mappings].sort(
      (a, b) => b[0].length - a[0].length,
    ))
      if (within(old, value)) return next + value.slice(old.length);
    return value;
  };
  function remap(value, field = "") {
    if (Array.isArray(value)) return value.map((item) => remap(item, field));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, remap(item, key)]),
      );
    if (
      typeof value === "string" &&
      ["folder", "sourcePath", "root", "roots", "cwd", "agentCwd"].includes(
        field,
      )
    )
      return remapPath(value);
    return value;
  }
  const moved = [],
    installed = [];
  try {
    await fs.mkdir(restored, { recursive: false });
    for (const folder of manifest.folders)
      await fs.mkdir(path.join(restored, folder.path), { recursive: true });
    for (const item of manifest.files) {
      const target = item.path.startsWith("app/")
        ? path.join(stage, item.path.slice(4))
        : item.path.startsWith("projects/")
          ? path.join(restored, item.path)
          : null;
      if (!target) continue;
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.copyFile(path.join(base, item.path), target);
      if ((await hashFile(target)) !== item.sha256)
        throw new Error(`Backup changed during restoration: ${item.path}`);
      await fs.chmod(target, item.mode & 0o777);
    }
    const next = remap(workspace);
    next.researchSetupVersion = 1;
    await atomicWrite(
      path.join(stage, "workspace.json"),
      JSON.stringify(validateState(next)),
      { mode: 0o600 },
    );
    // Cache entries refer to old file identities; recompute them on the next run.
    await fs.rm(path.join(stage, "ai/changes/index.json"), { force: true });
    const records = [];
    for (const folder of [
      "ai/conversations",
      "ai/chats",
      "ai/changes/runs",
      "pdf-annotations",
    ]) {
      const location = path.join(stage, folder);
      if (!(await fs.stat(location).catch(() => null))) continue;
      await walk(location, async (file, relative) => {
        if (!file.endsWith(".json")) return;
        let value = remap(JSON.parse(await fs.readFile(file, "utf8")));
        if (folder === "ai/conversations" || folder === "ai/chats") {
          if (
            !Array.isArray(value.messages) ||
            typeof value.profileId !== "string" ||
            !next.projects.some((p) => p.id === value.projectId)
          )
            throw new Error("Backup contains invalid conversation history.");
          delete value.threadId;
          value.restoredHistory = true;
          value.queuePaused = true;
          records.push({ file, value, active: folder === "ai/conversations" });
        }
        await atomicWrite(file, JSON.stringify(value), { mode: 0o600 });
      });
    }
    if (bindProfileId) {
      const unique = new Map();
      for (const record of records.sort(
        (a, b) => Number(a.active) - Number(b.active),
      ))
        unique.set(
          `${record.value.profileId}:${record.value.projectId}:${record.value.chatId || "legacy"}`,
          record,
        );
      await fs.rm(path.join(stage, "ai/conversations"), {
        recursive: true,
        force: true,
      });
      await fs.rm(path.join(stage, "ai/chats"), {
        recursive: true,
        force: true,
      });
      for (const { value } of unique.values()) {
        const oldProfile = value.profileId;
        value.profileId = bindProfileId;
        value.chatId = crypto.randomUUID();
        const key = hash(JSON.stringify([bindProfileId, value.projectId]));
        for (const message of value.messages) {
          const oldKey = hash(
            JSON.stringify([oldProfile, value.projectId, message.id]),
          );
          const newKey = hash(
            JSON.stringify([bindProfileId, value.projectId, message.id]),
          );
          if (oldKey !== newKey) {
            const old = path.join(stage, "ai/changes/runs", `${oldKey}.json`);
            if (await fs.stat(old).catch(() => null))
              await fs.rename(
                old,
                path.join(stage, "ai/changes/runs", `${newKey}.json`),
              );
          }
        }
        await atomicWrite(
          path.join(stage, "ai/chats", key, `${value.chatId}.json`),
          JSON.stringify(value),
          { mode: 0o600 },
        );
        await atomicWrite(
          path.join(stage, "ai/conversations", `${key}.json`),
          JSON.stringify(value),
          { mode: 0o600 },
        );
      }
    }
    for (const item of allowed) {
      const current = path.join(directory, item),
        previous = path.join(rollback, item),
        incoming = path.join(stage, item);
      await fs.mkdir(path.dirname(previous), { recursive: true });
      if (await fs.lstat(current).catch(() => null)) {
        await fs.rename(current, previous);
        moved.push(item);
      }
      if (await fs.lstat(incoming).catch(() => null)) {
        await fs.mkdir(path.dirname(current), { recursive: true });
        await fs.rename(incoming, current);
        installed.push(item);
      }
    }
    return {
      workspace: next,
      ui,
      rollback,
      restored,
      warnings: manifest.skipped || [],
    };
  } catch (error) {
    for (const item of installed.reverse())
      await fs.rm(path.join(directory, item), { recursive: true, force: true });
    for (const item of moved.reverse())
      await fs.rename(path.join(rollback, item), path.join(directory, item));
    await fs.rm(restored, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
module.exports = { createBackup, inspectBackup, restoreBackup };
