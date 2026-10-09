const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  nativeTheme,
  safeStorage,
  net,
} = require("electron");
app.setName("Research Workbench");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("./core.cjs");
const { resolveProjectReference } = require("./project-references.cjs");
const catalog = require("./catalog.cjs");
const git = require("./git.cjs");
const {
  createAnnotationStore,
  exportAnnotated,
} = require("./pdf-annotations.cjs");
const deadlines = require("./deadlines.cjs");
const {
  applySubmissionPlans,
  defaultToSystemAppearance,
} = require("./submission-plans.cjs");
const { migrateAreaLabels } = require("./area-labels.cjs");
const pty = require("node-pty");
const { createAI } = require("./ai.cjs");
const { AIError, publicError } = require("./chatgpt.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "research-pdf",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
if (process.env.RESEARCH_TEST_DATA)
  app.setPath("userData", path.resolve(process.env.RESEARCH_TEST_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
let win;
let ai;
app.on("second-instance", () => {
  win?.show();
  win?.focus();
});
let state;
let store;
let saveQueue = Promise.resolve();
let deadlineFeed;
let feedTimer;
function applyAppearance() {
  nativeTheme.themeSource = state?.appearance || "system";
  win?.setBackgroundColor(
    nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#fafbfc",
  );
}
async function persistDateChange(transform) {
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      const next = core.validateState(await transform(state));
      await core.atomicWrite(store, JSON.stringify(next, null, 2));
      state = next;
    });
  await saveQueue;
  return state;
}
async function feedResult(refresh = false) {
  const feed = await (refresh
    ? deadlineFeed.refresh()
    : deadlineFeed.snapshot());
  return { feed, updates: deadlines.changes(state, feed) };
}
const terminals = new Map();
const pdfs = new Map();
const builds = new Map();
const environment = {
  ...process.env,
  PATH: `/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin:/bin"}`,
};
function project(id) {
  const p = state.projects.find((p) => p.id === id);
  if (!p) throw new Error("Project no longer exists.");
  return p;
}
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function pdfUrl(
  file,
  projectId,
  name = path.basename(file),
  sourcePath = file,
) {
  const token = crypto.randomUUID();
  pdfs.set(token, { file, projectId, name, sourcePath });
  if (pdfs.size > 20) pdfs.delete(pdfs.keys().next().value);
  return `research-pdf://document/${token}`;
}
async function pdfDocument(id, url) {
  project(id);
  const parsed = new URL(url);
  const document =
    parsed.protocol === "research-pdf:" && parsed.hostname === "document"
      ? pdfs.get(parsed.pathname.slice(1))
      : null;
  if (!document || document.projectId !== id)
    throw new Error("PDF session expired. Reopen the document.");
  if (!document.bytes) {
    const metadata = await fs.stat(document.file);
    if (metadata.size > 64 * 1024 * 1024)
      throw new Error("PDF is too large to annotate (maximum 64 MB).");
    document.bytes = await fs.readFile(document.file);
  }
  return document;
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Unknown caller.");
    await saveQueue.catch(() => {});
    return fn(...args);
  });
}
function createWindow() {
  nativeTheme.themeSource = state?.appearance || "system";
  win = new BrowserWindow({
    width: 1510,
    height: 980,
    minWidth: 1050,
    minHeight: 700,
    title: "Research Workbench",
    titleBarStyle: "hiddenInset",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#fafbfc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("will-prevent-unload", (event) => {
    const response = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Keep editing", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
      message: "Close with unsaved manuscript changes?",
      detail: "Use ⌘S to save your manuscript before closing.",
    });
    if (response === 1) event.preventDefault();
  });
  if (process.env.RESEARCH_DEV_URL) win.loadURL(process.env.RESEARCH_DEV_URL);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
  win.on("closed", () => {
    ai?.dispose();
    for (const controller of builds.values()) controller.abort();
    for (const t of terminals.values()) t.process.kill();
    terminals.clear();
    win = null;
  });
}
app
  .whenReady()
  .then(async () => {
    const developmentIcon = path.join(__dirname, "../build/icon.png");
    if (!app.isPackaged && fsSync.existsSync(developmentIcon))
      app.dock?.setIcon(developmentIcon);
    store = path.join(app.getPath("userData"), "workspace.json");
    try {
      const saved = core.validateState(
        JSON.parse(await fs.readFile(store, "utf8")),
      );
      state = migrateAreaLabels(saved);
      if (state !== saved)
        await core.atomicWrite(store, JSON.stringify(state, null, 2));
    } catch (error) {
      if (error.code !== "ENOENT") {
        dialog.showErrorBox(
          "Workspace could not be loaded",
          `Your data has been preserved at ${store}.\n${error.message}`,
        );
        app.quit();
        return;
      }
      state = await core.seedWorkspace();
      await core.atomicWrite(store, JSON.stringify(state, null, 2));
    }
    const localCatalog = await catalog.researchCatalog();
    const activeWorkspace = core.validateState(
      catalog.attachImportedManuscripts(
        catalog.organizeLocalFolders(
          catalog.correctFlowWiseStatus(
            catalog.activateCurrentResearch(state, localCatalog),
          ),
          localCatalog,
        ),
        localCatalog,
      ),
    );
    if (activeWorkspace !== state) {
      await fs.copyFile(
        store,
        `${store}.before-current-research-${Date.now()}.bak`,
      );
      await core.atomicWrite(store, JSON.stringify(activeWorkspace, null, 2));
      state = activeWorkspace;
    }
    deadlineFeed = deadlines.createFeed(
      path.join(app.getPath("userData"), "ccf-deadlines-cache.json"),
    );
    let withDates = state;
    try {
      const tracker = await deadlines.readJson(
        path.join(deadlines.macDirectory(), "tracker.json"),
      );
      if (tracker)
        withDates = deadlines.importTracker(
          withDates,
          tracker,
          await deadlineFeed.snapshot(),
        );
    } catch (error) {
      console.error(
        "Mac deadlines were preserved; import failed:",
        error.message,
      );
    }
    withDates = core.validateState(deadlines.seedWeb(withDates));
    if (withDates !== state) {
      await fs.copyFile(
        store,
        `${store}.before-deadline-import-${Date.now()}.bak`,
      );
      await core.atomicWrite(store, JSON.stringify(withDates, null, 2));
      state = withDates;
    }
    const planned = core.validateState(
      defaultToSystemAppearance(applySubmissionPlans(state, localCatalog)),
    );
    if (planned !== state) {
      await fs.copyFile(
        store,
        `${store}.before-submission-plans-${Date.now()}.bak`,
      );
      await core.atomicWrite(store, JSON.stringify(planned, null, 2));
      state = planned;
    }
    handle("deadlines:feed", () => feedResult());
    handle("deadlines:refresh", async () => {
      const result = await feedResult(true);
      send("deadlines:updated", result);
      return result;
    });
    handle("deadlines:track", async (keys) => {
      const feed = await deadlineFeed.snapshot();
      return persistDateChange((current) =>
        deadlines.addFeedDates(current, feed, keys),
      );
    });
    handle("deadlines:accept", async (ids) => {
      const feed = await deadlineFeed.snapshot();
      return persistDateChange((current) =>
        deadlines.applyUpdates(current, feed, ids),
      );
    });
    handle("deadlines:import-mac", async () => {
      const tracker = await deadlines.readJson(
        path.join(deadlines.macDirectory(), "tracker.json"),
      );
      if (!tracker)
        throw new Error(
          "No saved mac-ddl-count tracker was found on this Mac.",
        );
      const feed = await deadlineFeed.snapshot();
      const before = state.trackedDeadlines?.length || 0;
      const next = await persistDateChange((current) =>
        deadlines.importTracker(
          { ...current, deadlineImportVersion: undefined },
          tracker,
          feed,
        ),
      );
      return {
        state: next,
        count: (next.trackedDeadlines?.length || 0) - before,
      };
    });
    protocol.handle("research-pdf", async (request) => {
      const token = new URL(request.url).pathname.slice(1);
      const document = pdfs.get(token);
      if (!document) return new Response("Document expired", { status: 404 });
      try {
        const bytes = document.bytes || (await fs.readFile(document.file));
        return new Response(bytes, {
          headers: {
            "Content-Type": "application/pdf",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        return new Response("Document unavailable", { status: 404 });
      }
    });
    handle("workspace:load", () => state);
    handle("catalog:list", () => catalog.researchCatalog());
    handle("catalog:add", async (ids) => {
      const collection = await catalog.researchCatalog();
      // Keep catalog additions in the same queue as ordinary workspace edits.
      let result;
      saveQueue = saveQueue
        .catch(() => {})
        .then(async () => {
          result = core.validateState(
            catalog.mergeCandidates(state, collection, ids),
          );
          if (result.projects.length !== state.projects.length) {
            await fs.copyFile(
              store,
              `${store}.before-research-${Date.now()}.bak`,
            );
            await core.atomicWrite(store, JSON.stringify(result, null, 2));
            state = result;
          }
        });
      await saveQueue;
      return state;
    });
    handle("workspace:save", (next) => {
      core.validateState(next);
      saveQueue = saveQueue
        .catch(() => {})
        .then(async () => {
          await core.atomicWrite(store, JSON.stringify(next, null, 2));
          for (const [key, session] of terminals) {
            const nextProject = next.projects.find(
              (p) => p.id === session.projectId,
            );
            const oldProject = state.projects.find(
              (p) => p.id === session.projectId,
            );
            if (
              !nextProject ||
              nextProject.folder !== oldProject?.folder ||
              (key.endsWith(":ssh") &&
                nextProject.sshHost !== oldProject?.sshHost)
            ) {
              terminals.delete(key);
              session.process.kill();
            }
          }
          state = next;
          applyAppearance();
        });
      return saveQueue.then(() => true);
    });
    handle("workspace:export", async () => {
      const choice = await dialog.showSaveDialog(win, {
        defaultPath: "research-workspace.json",
        filters: [{ name: "Workspace JSON", extensions: ["json"] }],
      });
      if (choice.canceled) return false;
      await saveQueue;
      await core.atomicWrite(choice.filePath, JSON.stringify(state, null, 2));
      return true;
    });
    handle("workspace:import", async () => {
      const choice = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "Workspace JSON", extensions: ["json"] }],
      });
      if (choice.canceled) return null;
      const imported = migrateAreaLabels(
        core.validateState(
          JSON.parse(await fs.readFile(choice.filePaths[0], "utf8")),
        ),
      );
      // Explicit workspace imports must keep their chosen project list on restart.
      imported.researchSetupVersion = 1;
      const confirm = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Cancel", "Import workspace"],
        defaultId: 0,
        message: "Replace the current project list?",
        detail:
          "A backup of your current workspace will be saved automatically. Project files are not changed.",
      });
      if (confirm.response !== 1) return null;
      await saveQueue;
      await core.atomicWrite(
        `${store}.backup-${Date.now()}.json`,
        JSON.stringify(state, null, 2),
      );
      await core.atomicWrite(store, JSON.stringify(imported, null, 2));
      for (const t of terminals.values()) t.process.kill();
      terminals.clear();
      pdfs.clear();
      state = imported;
      return state;
    });
    handle("folder:choose", async (id) => {
      project(id);
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory"],
        title: "Choose a project folder",
      });
      if (result.canceled) return null;
      return {
        folder: result.filePaths[0],
        files: await core.listFiles(result.filePaths[0]),
      };
    });
    handle("files:list", (id) => core.listFiles(project(id).folder));
    handle("files:project", (id) => core.projectFiles(project(id)));
    const gitOperations = new Set();
    handle("git:status", (id, rootId) =>
      git.status(core.fileRoot(project(id), rootId)),
    );
    handle("git:diff", (id, rootId, file) =>
      git.diff(core.fileRoot(project(id), rootId), file),
    );
    for (const operation of ["init", "connect", "commit", "sync"]) {
      handle(`git:${operation}`, async (id, rootId, argument, files) => {
        const folder = core.fileRoot(project(id), rootId);
        const current = await git.status(folder);
        const key = current.repository || (await fs.realpath(folder));
        if (gitOperations.has(key))
          throw new Error(
            "A Git operation is already running for this repository.",
          );
        gitOperations.add(key);
        try {
          return await git[operation](folder, argument, files);
        } finally {
          gitOperations.delete(key);
        }
      });
    }
    handle("file:read", async (id, relative, rootId) => {
      const target = await core.safeFile(
        core.fileRoot(project(id), rootId),
        relative,
      );
      if (!core.isTextFile(target)) throw new Error("Unsupported text file.");
      const stat = await fs.stat(target);
      if (stat.size > 2 * 1024 * 1024)
        throw new Error("File is too large to edit (maximum 2 MB).");
      return fs.readFile(target, "utf8");
    });
    handle("project:open-reference", async (id, reference, rootId) => {
      const resolved = await resolveProjectReference(project(id), reference, rootId);
      if (resolved.kind === "pdf")
        return { kind: "pdf", url: pdfUrl(resolved.target, id), name: path.basename(resolved.target) };
      return { kind: "text", file: resolved.file, rootId: resolved.rootId, line: resolved.line };
    });
    handle("file:write", async (id, relative, contents, rootId) => {
      if (ai?.isRunning(id))
        throw new Error(
          "Wait for the project agent to finish or stop it before saving.",
        );
      if (
        typeof contents !== "string" ||
        Buffer.byteLength(contents) > 2 * 1024 * 1024
      )
        throw new Error("File is too large.");
      const target = await core.safeFile(
        core.fileRoot(project(id), rootId),
        relative,
      );
      if (!core.isTextFile(target)) throw new Error("Unsupported text file.");
      await core.atomicWrite(target, contents);
      return true;
    });
    handle("file:create", async (id, name) => {
      if (
        typeof name !== "string" ||
        !/^[a-zA-Z0-9_. -]+\.(tex|bib|md|txt)$/.test(name) ||
        name.startsWith(".")
      )
        throw new Error(
          "Use a simple filename ending in .tex, .bib, .md, or .txt.",
        );
      const root = await fs.realpath(project(id).folder);
      const target = path.join(root, name);
      await fs.writeFile(
        target,
        name.endsWith(".tex") ? "\\section{New Section}\n" : "",
        { flag: "wx" },
      );
      return core.listFiles(root);
    });
    handle("pdf:last", async (id) => {
      const p = project(id);
      if (!p.folder || !p.mainFile) return null;
      try {
        const main = await core.safeFile(p.folder, p.mainFile);
        const file = path.join(
          path.dirname(main),
          ".research-build",
          path.basename(main, ".tex") + ".pdf",
        );
        await fs.access(file);
        return { url: pdfUrl(file, id), name: path.basename(file) };
      } catch {
        return null;
      }
    });
    handle("pdf:choose", async (id) => {
      project(id);
      const result = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      return result.canceled
        ? null
        : {
            url: pdfUrl(result.filePaths[0], id),
            name: path.basename(result.filePaths[0]),
          };
    });
    const annotationStore = createAnnotationStore(
      path.join(app.getPath("userData"), "pdf-annotations"),
    );
    let annotationQuitReady = false;
    app.on("before-quit", (event) => {
      if (annotationQuitReady || !annotationStore.hasPending()) return;
      event.preventDefault();
      void annotationStore.flush().finally(() => {
        annotationQuitReady = true;
        app.quit();
      });
    });
    handle("pdf:read-annotations", async (id, url) => {
      const document = await pdfDocument(id, url);
      const metadata = await annotationStore.load(
        id,
        document.bytes,
        document.name,
        document.sourcePath,
      );
      return {
        key: metadata.key,
        name: metadata.name,
        data: new Uint8Array(document.bytes),
        annotations: metadata.annotations,
        updatedAt: metadata.updatedAt,
      };
    });
    handle("pdf:save-annotations", async (id, url, annotations, pageCount) => {
      const document = await pdfDocument(id, url);
      return annotationStore.save(
        id,
        document.bytes,
        document.name,
        document.sourcePath,
        annotations,
        pageCount,
      );
    });
    handle("pdf:annotation-library", (id) => {
      project(id);
      return annotationStore.library(id);
    });
    handle("pdf:open-annotated", async (id, key) => {
      project(id);
      const archived = await annotationStore.archived(id, key);
      return {
        url: pdfUrl(archived.file, id, archived.name, archived.sourcePath),
        name: archived.name,
      };
    });
    handle("pdf:export-annotated", async (id, url, annotations, pageCount) => {
      const document = await pdfDocument(id, url);
      const bytes = await exportAnnotated(
        document.bytes,
        annotations,
        pageCount,
      );
      const choice = await dialog.showSaveDialog(win, {
        title: "Export annotated PDF",
        defaultPath: path.basename(document.name, ".pdf") + "-annotated.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (choice.canceled || !choice.filePath) return false;
      let target = path.resolve(choice.filePath);
      try {
        target = await fs.realpath(target);
      } catch {
        /* New output file. */
      }
      for (const source of new Set([document.file, document.sourcePath])) {
        const original = await fs
          .realpath(source)
          .catch(() => path.resolve(source));
        if (target === original)
          throw new Error("Export to a new file to preserve the original PDF.");
      }
      await core.atomicWrite(target, bytes);
      return true;
    });
    handle("latex:compile", async (id) => {
      if (ai?.isRunning(id))
        throw new Error(
          "Wait for the project agent to finish or stop it before compiling.",
        );
      if (builds.has(id)) throw new Error("This project is already compiling.");
      const controller = new AbortController();
      builds.set(id, controller);
      try {
        const result = await core.compile(
          project(id),
          (text) => send("latex:output", { projectId: id, text }),
          environment,
          controller.signal,
        );
        return { ...result, pdf: result.pdf ? pdfUrl(result.pdf, id) : null };
      } finally {
        builds.delete(id);
      }
    });
    handle("terminal:start", async (id, mode) => {
      const p = project(id);
      if (!["local", "ssh"].includes(mode))
        throw new Error("Invalid terminal mode.");
      const key = `${id}:${mode}`;
      const existing = terminals.get(key);
      if (existing) return { key, history: existing.history };
      const command =
        mode === "ssh" ? "/usr/bin/ssh" : process.env.SHELL || "/bin/zsh";
      const args = mode === "ssh" ? core.sshArgs(p.sshHost) : ["-l"];
      let cwd = app.getPath("home");
      if (p.folder) {
        if (!fsSync.existsSync(p.folder))
          throw new Error(
            "Project folder is unavailable. Attach a folder in project details.",
          );
        cwd = p.folder;
      }
      const child = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: 100,
        rows: 16,
        cwd,
        env: { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      const session = { process: child, history: "", projectId: id };
      terminals.set(key, session);
      child.onData((text) => {
        session.history = (session.history + text).slice(-100000);
        send("terminal:data", { key, text });
      });
      child.onExit(({ exitCode }) => {
        if (terminals.get(key) === session) {
          terminals.delete(key);
          send("terminal:exit", { key, exitCode });
        }
      });
      return { key, history: "" };
    });
    handle("terminal:write", (key, text) => {
      if (typeof text !== "string" || text.length > 65536)
        throw new Error("Invalid terminal input.");
      terminals.get(key)?.process.write(text);
    });
    handle("terminal:resize", (key, cols, rows) => {
      if (
        Number.isInteger(cols) &&
        Number.isInteger(rows) &&
        cols > 0 &&
        cols < 600 &&
        rows > 0 &&
        rows < 300
      )
        terminals.get(key)?.process.resize(cols, rows);
    });
    handle("terminal:stop", (key) => {
      const session = terminals.get(key);
      if (session) {
        terminals.delete(key);
        session.process.kill();
      }
    });
    handle("link:open", async (url) => {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol))
        throw new Error("Only web links can be opened.");
      await shell.openExternal(parsed.href);
    });
    handle("folder:reveal", (id, rootId) => {
      const folder = core.fileRoot(project(id), rootId);
      if (folder) shell.showItemInFolder(folder);
    });
    handle("app:info", () => ({ dataPath: store, version: app.getVersion() }));
    ai = createAI({
      directory: path.join(app.getPath("userData"), "ai"),
      encryption: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (bytes) => safeStorage.decryptString(bytes),
      },
      openBrowser: (url) => shell.openExternal(url),
      // Use Chromium networking so OAuth follows the desktop's proxy and TLS settings.
      fetcher: (url, options) => net.fetch(url, options),
      project,
      environment,
      scope: async (id, rootId) => {
        if (builds.has(id))
          throw new AIError(
            "project_build_running",
            "Wait for the current LaTeX build to finish before starting the agent.",
          );
        const p = project(id);
        const folder = core.fileRoot(p, rootId);
        if (!folder)
          throw new AIError(
            "project_folder_required",
            "Attach a local project folder before starting the agent.",
          );
        const cwd = await fs.realpath(folder);
        const roots = [
          p.folder,
          ...(p.localFolders || []).map((root) => root.folder),
        ].filter(Boolean);
        const writableRoots = [];
        for (const root of roots) {
          try {
            writableRoots.push(await fs.realpath(root));
          } catch {
            /* Detached or unavailable folders are excluded. */
          }
        }
        return { cwd, writableRoots: [...new Set(writableRoots)] };
      },
      validateContext: async (id, context) => {
        if (
          !context ||
          !["file", "selection"].includes(context.kind) ||
          typeof context.file !== "string" ||
          typeof context.text !== "string" ||
          !context.text.trim() ||
          Buffer.byteLength(context.text) > 200000
        )
          throw new AIError(
            "invalid_context",
            "Attach a text file or selection of up to 200 KB.",
          );
        const file = await core.safeFile(
          core.fileRoot(project(id), context.rootId),
          context.file,
        );
        if (!core.isTextFile(file))
          throw new AIError(
            "invalid_context",
            "Only project text files can be attached here.",
          );
      },
      emit: (channel, value) => send(`ai:${channel}`, value),
    });
    for (const [channel, operation] of Object.entries({
      "ai:state": () => ai.getState(),
      "ai:sign-in": (options) => ai.signIn(options),
      "ai:cancel-sign-in": () => ai.cancelSignIn(),
      "ai:select-profile": (id) => ai.selectProfile(id),
      "ai:disconnect": () => ai.disconnect(),
      "ai:models": () => ai.refreshModels(),
      "ai:conversation": (id) => ai.conversation(id),
      "ai:send": (request) => ai.send(request),
      "ai:stop": (id) => ai.stop(id),
      "ai:clear": (id) => ai.clear(id),
      "ai:answer": (request) => ai.answer(request),
      "ai:open-usage": () => ai.openUsage(),
    }))
      handle(channel, async (...args) => {
        try {
          return { ok: true, value: await operation(...args) };
        } catch (error) {
          return { ok: false, error: publicError(error) };
        }
      });
    createWindow();
    nativeTheme.on("updated", () =>
      win?.setBackgroundColor(
        nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#fafbfc",
      ),
    );
    if (
      !process.env.RESEARCH_TEST_DATA ||
      process.env.RESEARCH_TEST_FEED_NETWORK
    ) {
      const refresh = () =>
        void feedResult(true)
          .then((result) => send("deadlines:updated", result))
          .catch((error) => console.error(error.message));
      setTimeout(refresh, 1500).unref();
      feedTimer = setInterval(refresh, 6 * 60 * 60 * 1000);
      feedTimer.unref();
    }
    app.on("activate", () => {
      if (!win) createWindow();
    });
  })
  .catch((error) => {
    dialog.showErrorBox("Research Workbench", error.message);
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || process.env.RESEARCH_TEST_DATA)
    app.quit();
});
app.on("before-quit", () => {
  clearInterval(feedTimer);
  ai?.dispose();
});
