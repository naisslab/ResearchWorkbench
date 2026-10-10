const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { spawn, execFile } = require("node:child_process");
const runFile = promisify(execFile);
// Space-separated word lists keep these long vocabularies on a few lines.
const words = (list) => list.split(" ");
const STAGES = words(
  "exploration experiments writing submitted revision accepted published",
);
const DATE_KINDS = words(
  "abstract submission notification revision camera-ready other",
);
const DATE_CATEGORIES = words("paper funding award service other");
const DATE_STATUSES = words("notStarted ongoing finished");
const DATE_SOURCES = words("manual ccfddl official");
const EXTENSIONS = new Set(
  words(
    ".tex .ltx .dtx .bst .bbx .cbx .bib .sty .cls .md .txt .csv .json .yaml " +
      ".yml .toml .py .ipynb .r .sql .js .jsx .ts .tsx .mjs .cjs .css .html " +
      ".sh .zsh .bash .rs .go .c .cc .cpp .h .hpp",
  ),
);
const IGNORED = new Set(
  words("node_modules build dist vendor __pycache__ target venv"),
);
const DEFAULT_AREAS = [
  { id: "ml", name: "ML Systems", color: "#087cba", icon: "circuit" },
  {
    id: "security",
    name: "Security and Privacy",
    color: "#ab6f05",
    icon: "shield",
  },
  {
    id: "cps",
    name: "Cyber-Physical Systems",
    color: "#a04a95",
    icon: "radio",
  },
];
const text = (value) => typeof value === "string" && value.trim() !== "";
const isHttpUrl = (value) =>
  typeof value === "string" && /^https?:\/\//.test(value);
// Deadline links are optional, so "" also means no link.
const optionalUrl = (value) =>
  value === undefined || value === "" || isHttpUrl(value);
function stringList(value, max, message) {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((item) => !text(item)) ||
    new Set(value).size !== value.length
  )
    throw new Error(message);
  return value;
}
function validateState(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.areas)
  )
    throw new Error(
      "Invalid workspace format. Expected a version 1 workspace.",
    );
  if (value.projects.length > 500 || value.areas.length > 100)
    throw new Error("Workspace is too large.");
  if (
    value.appearance !== undefined &&
    !["light", "dark", "system"].includes(value.appearance)
  )
    throw new Error("Invalid appearance.");
  if (value.trackedDeadlines !== undefined) {
    if (
      !Array.isArray(value.trackedDeadlines) ||
      value.trackedDeadlines.length > 5000
    )
      throw new Error("Invalid tracked deadlines.");
    const dateIds = new Set();
    for (const d of value.trackedDeadlines) {
      if (
        !d ||
        !text(d.id) ||
        dateIds.has(d.id) ||
        !text(d.label) ||
        typeof d.subtitle !== "string" ||
        typeof d.time !== "string" ||
        !/Z$/.test(d.time) ||
        !Number.isFinite(Date.parse(d.time)) ||
        typeof d.timezone !== "string" ||
        !DATE_CATEGORIES.includes(d.category) ||
        !DATE_KINDS.includes(d.kind) ||
        !DATE_STATUSES.includes(d.status) ||
        !DATE_SOURCES.includes(d.source)
      )
        throw new Error("Invalid tracked deadline.");
      dateIds.add(d.id);
      if (d.projectIds !== undefined)
        stringList(d.projectIds, 500, "Invalid linked projects.");
      for (const field of words(
        "originalDate notes sourceKey conference eventId importedFrom projectId",
      ))
        if (d[field] !== undefined && typeof d[field] !== "string")
          throw new Error("Invalid deadline metadata.");
      if (!optionalUrl(d.url) || !optionalUrl(d.sourceUrl))
        throw new Error("Deadline source must be an HTTP or HTTPS URL.");
    }
  }
  const ids = new Set();
  for (const area of value.areas) {
    if (
      !area ||
      typeof area.id !== "string" ||
      !text(area.name) ||
      ids.has(area.id) ||
      !/^#[0-9a-f]{6}$/i.test(area.color)
    )
      throw new Error("Invalid research area.");
    ids.add(area.id);
  }
  const projectIds = new Set();
  for (const p of value.projects) {
    if (
      !p ||
      typeof p.id !== "string" ||
      projectIds.has(p.id) ||
      !text(p.name) ||
      !ids.has(p.areaId) ||
      !STAGES.includes(p.stage)
    )
      throw new Error("Invalid project.");
    projectIds.add(p.id);
    for (const field of words("catalogId topic icon sourceNote folderLabel"))
      if (p[field] !== undefined && typeof p[field] !== "string")
        throw new Error(`Invalid ${field}.`);
    for (const field of words("summary notes venue folder mainFile sshHost"))
      if (typeof p[field] !== "string") throw new Error(`Invalid ${field}.`);
    if (p.compileOnSave !== undefined && typeof p.compileOnSave !== "boolean")
      throw new Error("Invalid compileOnSave.");
    if (p.localFolders !== undefined) {
      if (!Array.isArray(p.localFolders) || p.localFolders.length > 30)
        throw new Error("Invalid local folders.");
      const folderIds = new Set(["primary"]);
      for (const folder of p.localFolders) {
        if (
          !folder ||
          !text(folder.id) ||
          folderIds.has(folder.id) ||
          !text(folder.label) ||
          typeof folder.folder !== "string" ||
          !path.isAbsolute(folder.folder)
        )
          throw new Error("Invalid local folder.");
        folderIds.add(folder.id);
      }
    }
    if (
      p.links !== undefined &&
      (!Array.isArray(p.links) ||
        p.links.length > 30 ||
        p.links.some(
          (link) =>
            !link || typeof link.label !== "string" || !isHttpUrl(link.url),
        ))
    )
      throw new Error("Project links must be HTTP or HTTPS URLs.");
    if (!Array.isArray(p.tasks) || !Array.isArray(p.deadlines))
      throw new Error("Invalid project tasks or dates.");
    for (const task of p.tasks)
      if (
        typeof task.id !== "string" ||
        typeof task.text !== "string" ||
        typeof task.done !== "boolean"
      )
        throw new Error("Invalid task.");
    for (const d of p.deadlines) {
      if (
        typeof d.id !== "string" ||
        typeof d.label !== "string" ||
        !DATE_KINDS.includes(d.kind) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
        !Number.isFinite(Date.parse(d.date)) ||
        new Date(d.date).toISOString().slice(0, 10) !== d.date
      )
        throw new Error("Invalid deadline.");
      if (!optionalUrl(d.url))
        throw new Error("Deadline source must be an HTTP or HTTPS URL.");
    }
  }
  return value;
}
async function atomicWrite(file, contents, { directoryMode, ...options } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: directoryMode });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { encoding: "utf8", ...options });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function safeFile(root, relative) {
  if (!root || typeof relative !== "string" || path.isAbsolute(relative))
    throw new Error("Choose a project folder and a relative file path.");
  const canonicalRoot = await fs.realpath(root);
  const target = await fs.realpath(path.resolve(canonicalRoot, relative));
  if (!target.startsWith(canonicalRoot + path.sep))
    throw new Error("File must be inside the project folder.");
  return target;
}
// A path that may not exist yet: plain names joined by "/" in an existing
// folder that, through any symlinks, stays inside `root`.
async function safeNewPath(root, relative) {
  if (
    typeof relative !== "string" ||
    !relative.split("/").every((part) => /^[\w -][\w. -]*$/.test(part))
  )
    throw new Error(
      "Use simple names separated by /, without .. or a leading dot.",
    );
  const canonicalRoot = await fs.realpath(root);
  const folder = path.dirname(relative);
  const parent = await fs
    .realpath(path.join(canonicalRoot, folder))
    .catch(() => {
      throw new Error(`Folder ${folder} does not exist.`);
    });
  if (parent !== canonicalRoot && !parent.startsWith(canonicalRoot + path.sep))
    throw new Error("File must be inside the project folder.");
  return path.join(parent, path.basename(relative));
}
// Breadth-first, eight directories at a time, within a directory-entry budget.
async function listFiles(root) {
  if (!root) return [];
  const results = [];
  let level = [root];
  let budget = 20000;
  for (let depth = 0; level.length && depth <= 6; depth++) {
    const next = [];
    for (
      let i = 0;
      i < level.length && budget > 0 && results.length < 1500;
      i += 8
    ) {
      const batch = level.slice(i, i + 8);
      const listings = await Promise.all(
        batch.map((dir) => fs.readdir(dir, { withFileTypes: true })),
      );
      listings.forEach((entries, index) => {
        budget -= entries.length;
        for (const entry of entries) {
          if (entry.name.startsWith(".") || IGNORED.has(entry.name)) continue;
          const file = path.join(batch[index], entry.name);
          if (entry.isDirectory()) next.push(file);
          else if (
            entry.isFile() &&
            isTextFile(entry.name) &&
            results.length < 1500
          )
            results.push(path.relative(root, file));
        }
      });
    }
    level = next;
  }
  return results.sort();
}
function isTextFile(file) {
  return (
    EXTENSIONS.has(path.extname(file).toLowerCase()) ||
    ["Makefile", "Dockerfile", "LICENSE"].includes(path.basename(file))
  );
}
function projectRoots(project) {
  return [
    ...(project.folder
      ? [
          {
            id: "primary",
            label:
              project.folderLabel ||
              (project.mainFile ? "Manuscript" : "Project"),
            folder: project.folder,
          },
        ]
      : []),
    ...(project.localFolders || []).filter((f) => f.folder !== project.folder),
  ];
}
function fileRoot(project, id = "primary") {
  const root = projectRoots(project).find((f) => f.id === id);
  if (!root)
    throw new Error("Local folder is no longer attached to this project.");
  return root.folder;
}
async function projectFiles(project) {
  return Promise.all(
    projectRoots(project).map(async (root) => {
      try {
        return { ...root, files: await listFiles(root.folder) };
      } catch {
        return {
          ...root,
          files: [],
          error: "Folder unavailable. Check its location in Finder.",
        };
      }
    }),
  );
}
function sshArgs(host) {
  if (
    typeof host !== "string" ||
    !/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host)
  )
    throw new Error(
      "Use an SSH config alias or user@hostname. Configure ports and keys in ~/.ssh/config.",
    );
  return [host];
}
const pdfPath = (main) =>
  path.join(
    path.dirname(main),
    ".research-build",
    path.basename(main, ".tex") + ".pdf",
  );
async function compile(project, onOutput, env = process.env, signal) {
  if (!project.mainFile.endsWith(".tex"))
    throw new Error("Select a .tex entry file first.");
  const main = await safeFile(project.folder, project.mainFile);
  const pdf = pdfPath(main);
  const output = path.dirname(pdf);
  await fs.mkdir(output, { recursive: true });
  const backup = path.join(output, `.previous-${crypto.randomUUID()}.pdf`);
  const sourceMaps = [".synctex.gz", ".synctex"].map((extension) => ({
    file: pdf.replace(/\.pdf$/, extension),
    backup: backup.replace(/\.pdf$/, extension),
    saved: false,
  }));
  const clone = (from, to) =>
    fs.copyFile(from, to, fs.constants.COPYFILE_FICLONE);
  let hasBackup = false;
  let started = false;
  try {
    await clone(pdf, backup);
    hasBackup = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const restore = async () => {
    if (!hasBackup || !started) return;
    await clone(backup, pdf);
    for (const sourceMap of sourceMaps) {
      if (sourceMap.saved) await clone(sourceMap.backup, sourceMap.file);
      else await fs.rm(sourceMap.file, { force: true });
    }
  };
  try {
    // A failed build keeps the PDF and its matching SyncTeX data together.
    for (const sourceMap of sourceMaps) {
      try {
        await clone(sourceMap.file, sourceMap.backup);
        sourceMap.saved = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    started = true;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        "latexmk",
        [
          "-pdf",
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-no-shell-escape",
          "-file-line-error",
          "-synctex=1",
          `-outdir=${output}`,
          "./" + path.basename(main),
        ],
        { cwd: path.dirname(main), env, detached: true },
      );
      let log = "";
      let stopped = "";
      let forceTimer;
      const append = (data) => {
        const text = data.toString();
        // Trimming only past twice the limit keeps appends linear.
        log += text;
        if (log.length > 300000) log = log.slice(-150000);
        onOutput?.(text);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const kill = (signal) => {
        try {
          process.kill(-child.pid, signal);
        } catch {}
      };
      const stop = (reason) => {
        stopped = reason;
        if (!child.pid) return;
        kill("SIGTERM");
        forceTimer = setTimeout(() => kill("SIGKILL"), 2000);
      };
      const abort = () => stop("Build canceled.");
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(
        () => stop("Compilation stopped after 90 seconds."),
        90000,
      );
      const settle = () => {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        signal?.removeEventListener("abort", abort);
      };
      child.once("error", (error) => {
        settle();
        reject(
          new Error(
            error.code === "ENOENT"
              ? "latexmk is missing. Install MacTeX or add your TeX tools to PATH, then restart the app."
              : error.message,
          ),
        );
      });
      child.once("close", async (code) => {
        settle();
        if (stopped)
          return resolve({ ok: false, log: `${log}\n${stopped}`, pdf: null });
        const ok =
          code === 0 &&
          (await fs.access(pdf).then(
            () => true,
            () => false,
          ));
        resolve({ ok, log, pdf: ok ? pdf : null });
      });
    });
    if (!result.ok) await restore();
    return result;
  } catch (error) {
    await restore();
    throw error;
  } finally {
    await fs.rm(backup, { force: true });
    for (const sourceMap of sourceMaps)
      await fs.rm(sourceMap.backup, { force: true });
  }
}
// The first record of synctex's output; {} when no position is available.
async function synctex(args, env) {
  const { stdout } = await runFile("synctex", args, {
    env,
    timeout: 10000,
  }).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error(
        "synctex is missing. Install MacTeX or add your TeX tools to PATH, then restart the app.",
      );
    return { stdout: "" };
  });
  const record = {};
  for (const [, key, value] of stdout.matchAll(/^(\w+):(.*)$/gm))
    record[key] ??= value;
  return record;
}
const builtMain = (project) =>
  safeFile(project.folder, project.mainFile).catch(() => null);
async function synctexForward(project, file, line, rootId, env) {
  if (!Number.isInteger(line) || line < 1) throw new Error("Invalid line.");
  const source = await safeFile(fileRoot(project, rootId), file);
  const main = await builtMain(project);
  if (!main) return null;
  const r = await synctex(
    ["view", "-i", `${line}:0:${source}`, "-o", pdfPath(main)],
    env,
  );
  return r.Page
    ? { page: Number(r.Page), x: Number(r.x), y: Number(r.y) }
    : null;
}
async function synctexInverse(project, page, x, y, env) {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    ![x, y].every(Number.isFinite) ||
    x < 0 ||
    y < 0
  )
    throw new Error("Invalid PDF position.");
  const main = await builtMain(project);
  if (!main) return null;
  const r = await synctex(
    ["edit", "-o", `${page}:${x}:${y}:${pdfPath(main)}`],
    env,
  );
  if (!r.Input) return null;
  const line = Number(r.Line);
  if (!Number.isInteger(line) || line < 1) return null;
  const input = await fs
    .realpath(path.resolve(path.dirname(main), r.Input))
    .catch(() => null);
  if (!input || !isTextFile(input)) return null;
  for (const root of projectRoots(project)) {
    const base = await fs.realpath(root.folder).catch(() => "");
    if (base && input.startsWith(base + path.sep))
      return {
        file: path.relative(base, input),
        rootId: root.id,
        line,
      };
  }
  return null;
}
function seedWorkspace() {
  return {
    version: 1,
    areaLabelVersion: 2,
    areas: DEFAULT_AREAS,
    projects: [],
  };
}
module.exports = {
  DEFAULT_AREAS,
  DATE_CATEGORIES,
  DATE_STATUSES,
  stringList,
  validateState,
  atomicWrite,
  safeFile,
  safeNewPath,
  listFiles,
  projectFiles,
  fileRoot,
  isTextFile,
  sshArgs,
  pdfPath,
  compile,
  synctexForward,
  synctexInverse,
  seedWorkspace,
};
