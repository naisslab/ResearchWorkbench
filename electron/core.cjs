const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const STAGES = [
  "exploration",
  "experiments",
  "writing",
  "submitted",
  "revision",
  "accepted",
  "published",
];
const EXTENSIONS = new Set([
  ".tex",
  ".ltx",
  ".dtx",
  ".bst",
  ".bbx",
  ".cbx",
  ".mjs",
  ".cjs",
  ".zsh",
  ".bash",
  ".cc",
  ".bib",
  ".md",
  ".txt",
  ".sty",
  ".cls",
  ".csv",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".rs",
  ".go",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".html",
  ".sql",
  ".r",
  ".ipynb",
]);
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
  if (value.appearance !== undefined && !['light', 'dark', 'system'].includes(value.appearance)) throw new Error('Invalid appearance.');
  if (value.trackedDeadlines !== undefined) {
    if (!Array.isArray(value.trackedDeadlines) || value.trackedDeadlines.length > 5000) throw new Error('Invalid tracked deadlines.');
    const dateIds = new Set();
    for (const d of value.trackedDeadlines) {
      if (!d || typeof d.id !== 'string' || !d.id || dateIds.has(d.id) || typeof d.label !== 'string' || !d.label.trim() || typeof d.subtitle !== 'string' || typeof d.time !== 'string' || !/Z$/.test(d.time) || !Number.isFinite(Date.parse(d.time)) || typeof d.timezone !== 'string' || !['paper','funding','award','service','other'].includes(d.category) || !['abstract','submission','notification','revision','camera-ready','other'].includes(d.kind) || !['notStarted','ongoing','finished'].includes(d.status) || !['manual','ccfddl','official'].includes(d.source)) throw new Error('Invalid tracked deadline.');
      dateIds.add(d.id);
      if (d.projectIds !== undefined && (!Array.isArray(d.projectIds) || d.projectIds.length > 500 || d.projectIds.some(id => typeof id !== 'string' || !id) || new Set(d.projectIds).size !== d.projectIds.length)) throw new Error('Invalid linked projects.');
      for (const field of ['originalDate','notes','sourceKey','conference','eventId','importedFrom','projectId']) if (d[field] !== undefined && typeof d[field] !== 'string') throw new Error('Invalid deadline metadata.');
      for (const field of ['url','sourceUrl']) if (d[field] !== undefined && (typeof d[field] !== 'string' || !/^https?:\/\//.test(d[field]))) throw new Error('Deadline source must be an HTTP or HTTPS URL.');
    }
  }
  const ids = new Set();
  for (const area of value.areas) {
    if (
      !area ||
      typeof area.id !== "string" ||
      typeof area.name !== "string" ||
      !area.name.trim() ||
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
      typeof p.name !== "string" ||
      !p.name.trim() ||
      !ids.has(p.areaId) ||
      !STAGES.includes(p.stage)
    )
      throw new Error("Invalid project.");
    projectIds.add(p.id);
    for (const field of [
      "catalogId",
      "topic",
      "icon",
      "sourceNote",
      "folderLabel",
    ])
      if (p[field] !== undefined && typeof p[field] !== "string")
        throw new Error(`Invalid ${field}.`);
    if (p.localFolders !== undefined) {
      if (!Array.isArray(p.localFolders) || p.localFolders.length > 30)
        throw new Error("Invalid local folders.");
      const folderIds = new Set(["primary"]);
      for (const folder of p.localFolders) {
        if (
          !folder ||
          typeof folder.id !== "string" ||
          !folder.id ||
          folderIds.has(folder.id) ||
          typeof folder.label !== "string" ||
          !folder.label.trim() ||
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
            !link ||
            typeof link.label !== "string" ||
            typeof link.url !== "string" ||
            !/^https?:\/\//.test(link.url),
        ))
    )
      throw new Error("Project links must be HTTP or HTTPS URLs.");
    for (const field of [
      "summary",
      "notes",
      "venue",
      "folder",
      "mainFile",
      "sshHost",
    ])
      if (typeof p[field] !== "string") throw new Error(`Invalid ${field}.`);
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
        ![
          "abstract",
          "submission",
          "notification",
          "revision",
          "camera-ready",
          "other",
        ].includes(d.kind) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
        !Number.isFinite(Date.parse(d.date)) ||
        new Date(d.date).toISOString().slice(0, 10) !== d.date
      )
        throw new Error("Invalid deadline.");
      if (d.url && (typeof d.url !== "string" || !/^https?:\/\//.test(d.url)))
        throw new Error("Deadline source must be an HTTP or HTTPS URL.");
    }
  }
  return value;
}
async function atomicWrite(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, "utf8");
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
async function listFiles(root) {
  if (!root) return [];
  const results = [];
  async function walk(dir, depth) {
    if (depth > 6 || results.length > 1500) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        [
          "node_modules",
          "build",
          "dist",
          "vendor",
          "__pycache__",
          "target",
          "venv",
        ].includes(entry.name)
      )
        continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && isTextFile(entry.name))
        results.push(path.relative(root, file));
    }
  }
  await walk(root, 0);
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
async function compile(project, onOutput, env = process.env, signal) {
  if (!project.mainFile.endsWith(".tex"))
    throw new Error("Select a .tex entry file first.");
  const main = await safeFile(project.folder, project.mainFile);
  const cwd = path.dirname(main);
  const output = path.join(cwd, ".research-build");
  await fs.mkdir(output, { recursive: true });
  const pdf = path.join(output, path.basename(main, ".tex") + ".pdf");
  const backup = path.join(output, `.previous-${crypto.randomUUID()}.pdf`);
  let hasBackup = false;
  try {
    await fs.copyFile(pdf, backup);
    hasBackup = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        "latexmk",
        [
          "-pdf",
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-no-shell-escape",
          `-outdir=${output}`,
          "./" + path.basename(main),
        ],
        { cwd, env, detached: process.platform !== "win32" },
      );
      let log = "";
      let timedOut = false;
      const append = (data) => {
        const text = data.toString();
        log = (log + text).slice(-150000);
        onOutput?.(text);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      let canceled = false;
      let forceTimer;
      const terminate = () => {
        if (!child.pid) return;
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {}
        forceTimer = setTimeout(() => {
          try {
            if (process.platform !== "win32")
              process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {}
        }, 2000);
      };
      const abort = () => {
        canceled = true;
        terminate();
      };
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, 90000);
      child.once("error", (error) => {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        signal?.removeEventListener("abort", abort);
        reject(
          new Error(
            error.code === "ENOENT"
              ? "latexmk is missing. Install MacTeX or add your TeX tools to PATH, then restart the app."
              : error.message,
          ),
        );
      });
      child.once("close", async (code) => {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        signal?.removeEventListener("abort", abort);
        if (canceled) {
          resolve({ ok: false, log: log + "\nBuild canceled.", pdf: null });
          return;
        }
        if (timedOut) {
          resolve({
            ok: false,
            log: log + "\nCompilation stopped after 90 seconds.",
            pdf: null,
          });
          return;
        }
        let exists = false;
        try {
          await fs.access(pdf);
          exists = true;
        } catch {
          /* No PDF produced */
        }
        resolve({
          ok: code === 0 && exists,
          log,
          pdf: code === 0 && exists ? pdf : null,
        });
      });
    });
    if (!result.ok && hasBackup) await fs.copyFile(backup, pdf);
    return result;
  } catch (error) {
    if (hasBackup) await fs.copyFile(backup, pdf);
    throw error;
  } finally {
    await fs.rm(backup, { force: true });
  }
}
async function seedWorkspace() {
  return {
    version: 1,
    areaLabelVersion: 2,
    areas: DEFAULT_AREAS,
    projects: [],
  };
}
module.exports = {
  STAGES,
  DEFAULT_AREAS,
  validateState,
  atomicWrite,
  safeFile,
  listFiles,
  projectFiles,
  fileRoot,
  isTextFile,
  sshArgs,
  compile,
  seedWorkspace,
};
