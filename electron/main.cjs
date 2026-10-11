const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  safeStorage,
  net,
  session,
  Notification,
  Menu,
} = require("electron");
app.setName("Research Workbench");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("./core.cjs");
const { createDraftStore } = require("./editor-drafts.cjs");
const backup = require("./backup.cjs");
const { createReferences } = require("./references.cjs");
const { pdfReportInWorker } = require("./pdf-report.cjs");
const { applicationMenu, editMenu } = require("./menu.cjs");
const { resolveProjectReference } = require("./project-references.cjs");
const catalog = require("./catalog.cjs");
const git = require("./git.cjs");
const {
  createAnnotationStore,
  exportAnnotated,
} = require("./pdf-annotations.cjs");
const deadlines = require("./deadlines.cjs");
const { migrateAreaLabels, runMigrations } = require("./migrations.cjs");
const pty = require("node-pty");
const { createAI } = require("./ai.cjs");
const { AIError, publicError } = require("./chatgpt.cjs");
const { createTaskQueue } = require("./task-queue.cjs");
const { createReminders } = require("./reminders.cjs");
if (process.env.RESEARCH_TEST_DATA)
  app.setPath("userData", path.resolve(process.env.RESEARCH_TEST_DATA));
if (!process.env.RESEARCH_TEST_DATA && !app.requestSingleInstanceLock())
  app.quit();
const { createDictation } = require("./dictation.cjs");
const dictation = createDictation({
  executable: app.isPackaged
    ? path.join(process.resourcesPath, "research-dictation")
    : path.join(__dirname, "../build/native/research-dictation"),
  emit: (event) => send("dictation:event", event),
});
app.on("before-quit", () => dictation.cancel());
const { createWritingCapture } = require("./writing.cjs");
const writingCapture = createWritingCapture((request) =>
  send("writing:capture", request),
);
let win;
let ai;
let maintenance = false;
let backupAbort;
let restoredPendingRestart = false;
app.on("second-instance", () => {
  win?.show();
  win?.focus();
});
let state;
let store;
// Workspace writes run one at a time, in request order.
const queue = createTaskQueue();
let deadlineFeed;
let feedTimer;
const windowBackground = () =>
  nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#f7f7f7";
function applyAppearance() {
  nativeTheme.themeSource = state.appearance || "system";
  win?.setBackgroundColor(windowBackground());
}
const writeJson = (file, value) =>
  core.atomicWrite(file, JSON.stringify(value, null, 2));
function updateState(transform, backup) {
  return queue(async () => {
    const next = core.validateState(await transform(state));
    if (next === state) return state;
    if (backup)
      await fs.copyFile(store, `${store}.before-${backup}-${Date.now()}.bak`);
    await writeJson(store, next);
    return (state = next);
  });
}
// A damaged workspace is kept; the user can start from the newest valid copy.
// Unreadable files (permissions, disk errors) are not replaced.
async function recoverWorkspace(error) {
  const backup = error.code ? null : await core.newestValidBackup(store);
  if (!backup) {
    dialog.showErrorBox(
      "Workspace could not be loaded",
      `Your data has been preserved at ${store}.\n${error.message}`,
    );
    return null;
  }
  const damaged = `${store}.damaged-${Date.now()}`;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Quit", "Restore backup"],
    defaultId: 0,
    cancelId: 0,
    message: "Workspace could not be loaded",
    detail: `${error.message}\n\nThe newest valid backup was saved ${new Date(backup.modified).toLocaleString()}; changes made after it are not included. Restoring keeps the damaged file as ${path.basename(damaged)}.`,
  });
  if (response !== 1) return null;
  await fs.copyFile(store, damaged);
  await writeJson(store, backup.state);
  return backup.state;
}
async function feedResult(refresh = false) {
  const feed = await (refresh
    ? deadlineFeed.refresh()
    : deadlineFeed.snapshot());
  return { feed, updates: deadlines.changes(state, feed) };
}
// Sends the first chunk at once, then at most one message per `delay` ms.
function coalesce(emit, delay) {
  let pending = "";
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!pending) return;
    emit(pending);
    pending = "";
    timer = setTimeout(flush, delay);
  };
  const push = (text) => {
    if (timer) pending += text;
    else {
      emit(text);
      timer = setTimeout(flush, delay);
    }
  };
  return Object.assign(push, { flush });
}
const terminals = new Map();
function stopTerminals(predicate = () => true) {
  for (const [key, session] of terminals)
    if (predicate(session, key)) {
      terminals.delete(key);
      session.process.kill();
    }
}
const pdfs = new Map();
const builds = new Map();
const environment = require("./environment.cjs");
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
  const { size, mtimeMs } = fsSync.statSync(file);
  const version = [file, projectId, name, sourcePath, size, mtimeMs].join("\0");
  // An unchanged PDF keeps its URL, so a no-op build leaves the reader as it is.
  for (const [url, document] of pdfs)
    if (document.version === version) {
      pdfs.delete(url);
      pdfs.set(url, document);
      return url;
    }
  const url = `research-pdf://document/${crypto.randomUUID()}`;
  pdfs.set(url, { file, projectId, name, sourcePath, version });
  // Four documents cover the open reader and saves still in flight.
  if (pdfs.size > 4) pdfs.delete(pdfs.keys().next().value);
  return url;
}
async function pdfDocument(id, url) {
  project(id);
  const document = pdfs.get(url);
  if (!document || document.projectId !== id)
    throw new Error("PDF session expired. Reopen the document.");
  pdfs.delete(url);
  pdfs.set(url, document);
  if (!document.bytes) {
    const metadata = await fs.stat(document.file);
    if (metadata.size > core.MAX_PDF_BYTES)
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
    if (
      maintenance &&
      !["backup:restart", "backup:cancel", "app:info"].includes(channel)
    )
      throw new Error(
        "Workspace backup or restoration is in progress. Please wait.",
      );
    return fn(...args);
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1510,
    height: 980,
    minWidth: 1050,
    minHeight: 700,
    title: "Research Workbench",
    titleBarStyle: "hiddenInset",
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  editMenu(win);
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("did-start-navigation", () => {
    dictation.cancel();
    writingCapture.cancel();
  });
  win.webContents.on("render-process-gone", () => {
    dictation.cancel();
    writingCapture.cancel();
  });
  win.webContents.on("will-prevent-unload", (event) => {
    const response = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Keep editing", "Close window"],
      defaultId: 0,
      cancelId: 0,
      message: "Close with unsaved manuscript changes?",
      detail:
        "Use ⌘S to save your manuscript. Recovery drafts are kept separately; very recent edits may not have reached the recovery copy yet.",
    });
    if (response === 1) event.preventDefault();
  });
  if (process.env.RESEARCH_DEV_URL) win.loadURL(process.env.RESEARCH_DEV_URL);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
  win.on("closed", () => {
    dictation.cancel();
    writingCapture.cancel();
    // macOS keeps the app running, so a reopened window still needs the AI;
    // only work that reports to this window stops here.
    void ai?.stopAll().catch(() => {});
    for (const controller of builds.values()) controller.abort();
    stopTerminals();
    win = null;
  });
}
app
  .whenReady()
  .then(async () => {
    // The page needs only clipboard writes for its copy buttons; camera,
    // microphone, location and notification requests are refused.
    session.defaultSession.setPermissionRequestHandler((_, permission, done) =>
      done(permission === "clipboard-sanitized-write"),
    );
    const developmentIcon = path.join(__dirname, "../build/icon.png");
    if (!app.isPackaged && fsSync.existsSync(developmentIcon))
      app.dock?.setIcon(developmentIcon);
    store = path.join(app.getPath("userData"), "workspace.json");
    deadlineFeed = deadlines.createFeed(
      path.join(app.getPath("userData"), "ccf-deadlines-cache.json"),
      // Chromium networking follows the desktop's proxy, as sign-in does.
      { fetch: (url, options) => net.fetch(url, options) },
    );
    await backup.recoverRestore(app.getPath("userData"));
    let saved;
    try {
      saved = core.validateState(JSON.parse(await fs.readFile(store, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") {
        saved = await recoverWorkspace(error);
        if (!saved) {
          app.quit();
          return;
        }
      }
    }
    state = await runMigrations(saved || core.seedWorkspace(), {
      catalog: () => catalog.researchCatalog(),
      tracker: deadlines.readMacTracker,
      feed: () => deadlineFeed.snapshot(),
    });
    if (state !== saved) {
      if (saved)
        await fs.copyFile(store, `${store}.before-migration-${Date.now()}.bak`);
      await writeJson(store, state);
    }
    applyAppearance();
    const references = createReferences((url, options) =>
      net.fetch(url, options),
    );
    handle("references:lookup", (input) => references.lookup(input));
    handle("references:bibtex", (kind, id) => references.bibtex(kind, id));
    handle("deadlines:feed", () => feedResult());
    handle("deadlines:refresh", () => feedResult(true));
    handle("deadlines:updates", async () =>
      deadlines.changes(state, await deadlineFeed.snapshot()),
    );
    for (const [channel, apply] of [
      ["deadlines:track", deadlines.addFeedDates],
      ["deadlines:accept", deadlines.applyUpdates],
    ])
      handle(channel, async (ids) => {
        const feed = await deadlineFeed.snapshot();
        return updateState((current) => apply(current, feed, ids));
      });
    handle("deadlines:import-mac", async () => {
      const tracker = await deadlines.readMacTracker();
      if (!tracker)
        throw new Error(
          "No saved mac-ddl-count tracker was found on this Mac.",
        );
      const feed = await deadlineFeed.snapshot();
      const before = state.trackedDeadlines?.length || 0;
      const next = await updateState((current) =>
        deadlines.importTracker(current, tracker, feed),
      );
      return {
        state: next,
        count: (next.trackedDeadlines?.length || 0) - before,
      };
    });
    const searchEngine = require("./search.cjs").createSearch({
      directory: app.getPath("userData"),
      workspace: () => state,
      ai: () => ai,
      emit: (packet) => send("search:progress", packet),
    });
    handle("search:query", (query, id) => searchEngine.search(query, id));
    handle("search:cancel", () => searchEngine.cancel());
    app.on("before-quit", () => void searchEngine.dispose());
    handle("search:open-pdf", async (hit) => {
      const p = project(hit.projectId);
      let target, name, sourcePath;
      if (hit.documentKey) {
        const archived = await annotationStore.archived(p.id, hit.documentKey);
        target = archived.file;
        name = archived.name;
        sourcePath = archived.sourcePath;
      } else {
        target = await core.safeFile(core.fileRoot(p, hit.rootId), hit.file);
        if (!/\.pdf$/i.test(target)) throw new Error("Choose a PDF result.");
        name = path.basename(target);
        sourcePath = target;
      }
      if ((await fs.stat(target)).size > core.MAX_PDF_BYTES)
        throw new Error("PDF exceeds 64 MB.");
      if (
        hit.version &&
        crypto
          .createHash("sha256")
          .update(await fs.readFile(target))
          .digest("hex") !== hit.version
      )
        throw new Error(
          "This PDF changed since the search. Search again to find its current position.",
        );
      return { url: pdfUrl(target, p.id, name, sourcePath), name };
    });
    handle("writing:complete", (id, result) =>
      writingCapture.complete(id, result),
    );
    handle("dictation:start", (id) => dictation.start(id));
    handle("dictation:stop", (id) => dictation.stop(id));
    handle("dictation:cancel", (id) => dictation.cancel(id));
    handle("workspace:load", () => state);
    handle("catalog:list", () => catalog.researchCatalog());
    handle("catalog:add", async (ids) => {
      const collection = await catalog.researchCatalog();
      return updateState(
        (current) => catalog.mergeCandidates(current, collection, ids),
        "research",
      );
    });
    // Memory changes at once, so no handler waits for the disk; the queued
    // write stores whatever state is current when it runs.
    handle("workspace:save", (next) => {
      core.validateState(next);
      stopTerminals(({ projectId }, key) => {
        const after = next.projects.find((p) => p.id === projectId);
        const before = state.projects.find((p) => p.id === projectId);
        return (
          !after ||
          after.folder !== before?.folder ||
          (key.endsWith(":ssh") && after.sshHost !== before?.sshHost)
        );
      });
      state = next;
      applyAppearance();
      return queue(() => writeJson(store, state)).then(() => true);
    });
    handle("workspace:export", async () => {
      const choice = await dialog.showSaveDialog(win, {
        defaultPath: "research-workspace.json",
        filters: [{ name: "Workspace JSON", extensions: ["json"] }],
      });
      if (choice.canceled) return false;
      await writeJson(choice.filePath, state);
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
      await updateState(() => imported, "import");
      stopTerminals();
      pdfs.clear();
      return state;
    });
    handle("folder:choose", async (id) => {
      project(id);
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory"],
        title: "Choose a project folder",
      });
      if (result.canceled) return null;
      const folder = result.filePaths[0];
      const files = await core.listFiles(folder);
      const mainFile = files.includes("main.tex")
        ? "main.tex"
        : files.find((f) => f.endsWith(".tex")) || "";
      return { folder, files, mainFile };
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
        const key = await git.toplevel(folder);
        if (ai?.isRunning(id))
          throw new Error(
            "Wait for the project agent or restore to finish before changing Git files.",
          );
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
    async function textTarget(id, relative, rootId) {
      const target = await core.safeFile(
        core.fileRoot(project(id), rootId),
        relative,
      );
      if (!core.isTextFile(target)) throw new Error("Unsupported text file.");
      return target;
    }
    const drafts = createDraftStore(
      path.join(app.getPath("userData"), "editor-drafts"),
    );
    const draftRequests = createTaskQueue();
    handle("file:draft-read", (id, relative, rootId) =>
      draftRequests(async () => {
        await textTarget(id, relative, rootId);
        return drafts.read(
          id,
          rootId,
          relative,
          core.fileRoot(project(id), rootId),
        );
      }),
    );
    handle("file:draft-write", (id, relative, rootId, draft) =>
      draftRequests(async () => {
        await textTarget(id, relative, rootId);
        return drafts.write(
          id,
          rootId,
          relative,
          core.fileRoot(project(id), rootId),
          draft,
        );
      }),
    );
    handle("file:read", async (id, relative, rootId) => {
      const target = await textTarget(id, relative, rootId);
      if ((await fs.stat(target)).size > 2 * 1024 * 1024)
        throw new Error("File is too large to edit (maximum 2 MB).");
      return fs.readFile(target, "utf8");
    });
    handle(
      "file:mtime",
      async (id, relative, rootId) =>
        (await fs.stat(await textTarget(id, relative, rootId))).mtimeMs,
    );
    handle(
      "project:open-reference",
      async (id, reference, rootId, action = "open") => {
        if (action !== "open" && action !== "reveal")
          throw new Error("Unknown file action.");
        const resolved = await resolveProjectReference(
          project(id),
          reference,
          rootId,
        );
        if (action === "reveal" || resolved.kind === "finder") {
          shell.showItemInFolder(resolved.target);
          return { kind: "finder" };
        }
        if (resolved.kind === "pdf")
          return {
            kind: "pdf",
            url: pdfUrl(resolved.target, id),
            name: path.basename(resolved.target),
          };
        return {
          kind: "text",
          file: resolved.file,
          rootId: resolved.rootId,
          line: resolved.line,
        };
      },
    );
    handle("file:write", async (id, relative, contents, rootId, expected) => {
      if (ai?.isRunning(id))
        throw new Error(
          "Wait for the project agent to finish or stop it before saving.",
        );
      if (
        typeof contents !== "string" ||
        Buffer.byteLength(contents) > 2 * 1024 * 1024
      )
        throw new Error("File is too large.");
      const target = await textTarget(id, relative, rootId);
      if (
        expected !== undefined &&
        (await fs.stat(target)).mtimeMs !== expected
      )
        throw new Error("Changed on disk since it was opened.");
      await core.atomicWrite(target, contents);
      return (await fs.stat(target)).mtimeMs;
    });
    handle("file:create", async (id, name, rootId) => {
      if (!/\.(tex|bib|md|txt)$/.test(name))
        throw new Error("Use a filename ending in .tex, .bib, .md, or .txt.");
      const target = await core.safeNewPath(
        core.fileRoot(project(id), rootId),
        name,
      );
      await fs
        .writeFile(
          target,
          name.endsWith(".tex") ? "\\section{New Section}\n" : "",
          { flag: "wx" },
        )
        .catch((error) => {
          throw error.code === "EEXIST"
            ? new Error(`${name} already exists in this project.`)
            : error;
        });
      return true;
    });
    handle("file:rename", async (id, rootId, from, to) => {
      const source = await textTarget(id, from, rootId);
      const target = await core.safeNewPath(
        core.fileRoot(project(id), rootId),
        to,
      );
      if (!core.isTextFile(target))
        throw new Error("Keep an editable extension, such as .tex or .py.");
      const existing = await fs.lstat(target).catch(() => null);
      // A case-only rename on a case-insensitive volume finds the source itself.
      if (existing && existing.ino !== (await fs.stat(source)).ino)
        throw new Error(`${to} already exists in this project.`);
      await fs.rename(source, target);
    });
    handle("file:trash", async (id, rootId, file) =>
      shell.trashItem(await textTarget(id, file, rootId)),
    );
    handle("pdf:last", async (id) => {
      const p = project(id);
      if (!p.folder || !p.mainFile) return null;
      try {
        const file = core.pdfPath(await core.safeFile(p.folder, p.mainFile));
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
    void annotationStore.pruneAll();
    // will-quit comes after every window has closed, so the quit can no longer
    // be cancelled and the reader's last save is already queued.
    let shutDown = false;
    app.on("will-quit", (event) => {
      clearInterval(feedTimer);
      if (shutDown) return;
      shutDown = true;
      event.preventDefault();
      const limit = new Promise((resolve) => setTimeout(resolve, 5000));
      // Every window is closed by now, so exit skips the quit events instead
      // of asking Electron to quit again while it unwinds this one.
      void Promise.race([
        Promise.allSettled([
          queue.settled(),
          annotationStore.flush(),
          draftRequests.settled().then(() => drafts.flush()),
          ai?.dispose(),
        ]),
        limit,
      ]).finally(() => app.exit());
    });
    const backupStatus = path.join(
      app.getPath("userData"),
      "backup-status.json",
    );
    handle("backup:cancel", () =>
      backupAbort?.abort(
        new Error("Backup cancelled. Temporary copies were removed."),
      ),
    );
    handle("backup:status", () =>
      fs.readFile(backupStatus, "utf8").then(JSON.parse, () => null),
    );
    function checkIdle() {
      if (
        builds.size ||
        gitOperations.size ||
        state.projects.some((p) => ai?.isRunning(p.id))
      )
        throw new Error(
          "Wait for agents, builds and Git operations to finish before backing up or restoring.",
        );
    }
    handle("backup:create", async (options = {}) => {
      checkIdle();
      const choice = await dialog.showOpenDialog(win, {
        title: "Choose a backup destination",
        properties: ["openDirectory", "createDirectory"],
      });
      if (choice.canceled) return null;
      checkIdle();
      maintenance = true;
      backupAbort = new AbortController();
      let lastProgress = 0;
      try {
        await queue.settled();
        await annotationStore.idle();
        await draftRequests.settled();
        await drafts.flush();
        await ai.flush();
        checkIdle();
        const result = await backup.createBackup({
          directory: app.getPath("userData"),
          destination: choice.filePaths[0],
          workspace: state,
          includeProjects: options.includeProjects !== false,
          ui: options.ui || {},
          signal: backupAbort.signal,
          progress: (value) => {
            if (Date.now() - lastProgress > 150) {
              send("backup:progress", value);
              lastProgress = Date.now();
            }
          },
        });
        const status = {
          path: result.path,
          createdAt: result.createdAt,
          bytes: result.bytes,
          files: result.files.length,
          skipped: result.skipped,
        };
        await writeJson(backupStatus, status);
        return status;
      } finally {
        maintenance = false;
        backupAbort = undefined;
      }
    });
    handle("backup:restore", async (bindCurrentAccount = false) => {
      checkIdle();
      const choice = await dialog.showOpenDialog(win, {
        title: "Choose a Research backup folder",
        properties: ["openDirectory"],
      });
      if (choice.canceled) return null;
      const info = await backup.inspectBackup(choice.filePaths[0]);
      const profileId = bindCurrentAccount
        ? (await ai.getState()).activeProfileId
        : undefined;
      if (bindCurrentAccount && !profileId)
        throw new Error(
          "Sign in before assigning restored conversations to the current account.",
        );
      const confirm = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Cancel", "Restore and restart"],
        defaultId: 0,
        message: `Restore ${info.workspace.projects.length} projects from ${info.manifest.createdAt}?`,
        detail: `The current workspace will be kept as a rollback copy. Project files will be copied into a new folder. ${bindCurrentAccount ? "All restored conversations will belong to the currently signed-in account. " : "Conversation account ownership will be preserved. "}The application will restart. Login credentials are not included in the backup.`,
      });
      if (confirm.response !== 1) return null;
      const destination = await dialog.showOpenDialog(win, {
        title: "Choose where to restore project folders",
        properties: ["openDirectory", "createDirectory"],
      });
      if (destination.canceled) return null;
      checkIdle();
      maintenance = true;
      try {
        await queue.settled();
        await annotationStore.idle();
        await draftRequests.settled();
        await drafts.flush();
        await ai.flush();
        checkIdle();
        stopTerminals();
        await searchEngine.dispose();
        const result = await backup.restoreBackup({
          bundle: choice.filePaths[0],
          directory: app.getPath("userData"),
          destination: destination.filePaths[0],
          bindProfileId: profileId,
        });
        state = result.workspace;
        pdfs.clear();
        await ai.dispose();
        restoredPendingRestart = true;
        return result;
      } finally {
        if (!restoredPendingRestart) maintenance = false;
      }
    });
    handle("backup:restart", () => {
      if (!restoredPendingRestart)
        throw new Error("No restored workspace is waiting to restart.");
      app.relaunch();
      app.exit(0);
    });
    handle("pdf:read-annotations", async (id, url) => {
      const document = await pdfDocument(id, url);
      const metadata = await annotationStore.load(
        id,
        document.bytes,
        document.name,
        document.sourcePath,
      );
      const main = await core
        .safeFile(project(id).folder, project(id).mainFile)
        .catch(() => null);
      return {
        key: metadata.key,
        archived:
          path.resolve(document.file) !== path.resolve(document.sourcePath),
        compiled:
          !!main && path.resolve(document.sourcePath) === core.pdfPath(main),
        name: metadata.name,
        data: document.bytes,
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
    handle("pdf:restore", async (id, key, keepArchived) => {
      project(id);
      const archived = await annotationStore.archived(id, key);
      if (
        !keepArchived &&
        typeof archived.sourcePath === "string" &&
        /\.pdf$/i.test(archived.sourcePath)
      ) {
        const stat = await fs.stat(archived.sourcePath).catch(() => null);
        if (stat?.isFile() && stat.size <= core.MAX_PDF_BYTES)
          return {
            url: pdfUrl(archived.sourcePath, id, archived.name),
            name: archived.name,
          };
      }
      return {
        url: pdfUrl(archived.file, id, archived.name, archived.sourcePath),
        name: archived.name,
      };
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
    // Decisions about a project's latexmkrc, kept outside the workspace so
    // renderer saves cannot change them. Any edit to the file, including an
    // agent's, asks again. Skipping it lasts until the app restarts.
    const trustFile = path.join(app.getPath("userData"), "build-trust.json");
    // A damaged record only means asking again.
    const readTrust = () =>
      fs
        .readFile(trustFile, "utf8")
        .then(JSON.parse)
        .then((value) => (value && typeof value === "object" ? value : {}))
        .catch(() => ({}));
    const skipped = new Map();
    async function confirmBuildConfig(id, config) {
      const key = `${id}\0${config.directory}`;
      if ((await readTrust())[key] === config.hash) return true;
      if (skipped.get(key) === config.hash) return false;
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Compile without it", "Trust and compile"],
        defaultId: 0,
        cancelId: 0,
        message: `Run this project's ${config.files.join(" and ")}?`,
        detail:
          "latexmk configuration files are Perl programs. They run with your full permissions, outside the agent sandbox. Trust one only if you or a collaborator wrote it. You will be asked again whenever it changes, and after a restart if you skip it.",
      });
      if (response !== 1) {
        skipped.set(key, config.hash);
        return false;
      }
      await queue(async () => {
        const decisions = await readTrust();
        decisions[key] = config.hash;
        await writeJson(trustFile, decisions);
      }, "build-trust");
      return true;
    }
    // Compile and its latexdiff variant share the build slot, output stream
    // and latexmkrc trust.
    const build = async (id, run) => {
      if (ai?.isRunning(id))
        throw new Error(
          "Wait for the project agent to finish or stop it before compiling.",
        );
      if (builds.has(id)) throw new Error("This project is already compiling.");
      const controller = new AbortController();
      builds.set(id, controller);
      const output = coalesce(
        (text) => send("latex:output", { projectId: id, text }),
        100,
      );
      try {
        const result = await run(output, controller.signal, (config) =>
          confirmBuildConfig(id, config),
        );
        return { ...result, pdf: result.pdf ? pdfUrl(result.pdf, id) : null };
      } finally {
        output.flush();
        builds.delete(id);
      }
    };
    handle("latex:compile", (id) =>
      build(id, (output, signal, confirm) =>
        core.compile(project(id), output, environment, signal, confirm),
      ),
    );
    handle("latex:diff", (id, revision) =>
      build(id, (output, signal, confirm) =>
        core.compileDiff(
          project(id),
          revision,
          output,
          environment,
          signal,
          confirm,
        ),
      ),
    );
    handle("latex:cancel", (id) => builds.get(id)?.abort());
    // The compiled PDF's pages, fonts and metadata for the submission check.
    // The compiled PDF's pages, fonts and metadata for the submission check,
    // reused until the PDF changes. `references` is given only when a page
    // limit needs the bibliography's position.
    let lastReport = { version: "", report: null };
    handle("latex:pdf-report", async (id, references) => {
      const p = project(id);
      const main = await core.safeFile(p.folder, p.mainFile);
      const file = core.pdfPath(main);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) return null;
      if (stat.size > core.MAX_PDF_BYTES)
        throw new Error("The PDF exceeds 64 MB and was not checked.");
      const version = [file, stat.size, stat.mtimeMs].join("\0");
      const [report, at] = await Promise.all([
        lastReport.version === version
          ? lastReport.report
          : pdfReportInWorker(file).then((report) => {
              lastReport = { version, report };
              return report;
            }),
        typeof references?.file === "string" &&
        Number.isInteger(references?.line)
          ? core
              .referencesStart(p, references.file, references.line, environment)
              .catch(() => null)
          : null,
      ]);
      return {
        ...report,
        references: at && at.page <= report.pages ? at : null,
      };
    });
    // SyncTeX maps only the project's compiled PDF; a latexdiff, an older
    // version or another document has no map of the manuscript.
    async function compiledPdf(id, url) {
      const p = project(id);
      const document = pdfs.get(url);
      if (!document || document.projectId !== id)
        throw new Error("PDF session expired. Reopen the document.");
      if (builds.has(id))
        throw new Error(
          "Wait for compilation to finish before locating the source.",
        );
      const main = await core.safeFile(p.folder, p.mainFile).catch(() => null);
      if (!main || document.file !== core.pdfPath(main))
        throw new Error(
          "Source lookup requires this project's compiled PDF. Compile the manuscript and use its PDF preview.",
        );
      return { p, document };
    }
    handle("synctex:forward", async (id, file, line, rootId, url) => {
      const { p } = await compiledPdf(id, url);
      return core.synctexForward(p, file, line, rootId, environment);
    });
    handle("synctex:inverse", async (id, page, x, y, url) => {
      const { p, document } = await compiledPdf(id, url);
      const metadata = await fs.stat(document.file).catch(() => null);
      const version =
        metadata &&
        [
          document.file,
          id,
          document.name,
          document.sourcePath,
          metadata.size,
          metadata.mtimeMs,
        ].join("\0");
      if (version !== document.version)
        throw new Error(
          "The PDF has changed on disk. Compile again to refresh the preview before locating the source.",
        );
      return core.synctexInverse(p, page, x, y, environment);
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
      const output = coalesce(
        (text) => send("terminal:data", { key, text }),
        8,
      );
      child.onData((text) => {
        session.history += text;
        if (session.history.length > 200000)
          session.history = session.history.slice(-100000);
        output(text);
      });
      child.onExit(({ exitCode }) => {
        output.flush();
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
      const child = terminals.get(key)?.process;
      if (
        child &&
        Number.isInteger(cols) &&
        Number.isInteger(rows) &&
        cols > 0 &&
        cols < 600 &&
        rows > 0 &&
        rows < 300 &&
        (cols !== child.cols || rows !== child.rows)
      )
        child.resize(cols, rows);
    });
    handle("terminal:stop", (key) => stopTerminals((_, k) => k === key));
    handle("link:open", async (url) => {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol))
        throw new Error("Only web links can be opened.");
      await shell.openExternal(parsed.href);
    });
    handle("folder:reveal", async (id, rootId, file) => {
      const folder = core.fileRoot(project(id), rootId);
      shell.showItemInFolder(file ? await core.safeFile(folder, file) : folder);
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
      recordWriting: (id, capture, signal) => {
        project(id);
        return writingCapture.request(id, capture, signal);
      },
      environment,
      skillRoots: [
        path.join(app.getPath("home"), ".agents", "skills"),
        path.join(app.getPath("home"), ".codex", "skills"),
      ],
      scope: async (id, rootId) => {
        if (builds.has(id))
          throw new AIError(
            "project_build_running",
            "Wait for the current LaTeX build to finish before starting the agent.",
          );
        if (gitOperations.size)
          throw new AIError(
            "project_git_running",
            "Wait for the current Git operation to finish before starting the agent or restoring files.",
          );
        const p = project(id);
        const folder =
          (!rootId || rootId === "primary") && !p.folder
            ? ""
            : core.fileRoot(p, rootId);
        if (!folder) {
          const cwd = path.join(
            app.getPath("userData"),
            "ai",
            "writing-workspaces",
            crypto.createHash("sha256").update(id).digest("hex"),
          );
          await fs.mkdir(cwd, { recursive: true });
          return {
            cwd: await fs.realpath(cwd),
            writableRoots: [await fs.realpath(cwd)],
          };
        }
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
          !["file", "selection", "pdf"].includes(context.kind) ||
          typeof context.file !== "string" ||
          typeof context.text !== "string" ||
          !context.text.trim() ||
          Buffer.byteLength(context.text) > 200000
        )
          throw new AIError(
            "invalid_context",
            "Attach a text file or selection of up to 200 KB.",
          );
        if (context.kind === "pdf") {
          if (!Number.isInteger(context.page) || context.page < 1)
            throw new AIError("invalid_context", "Choose a PDF page.");
          // The excerpt carries its own text, so a copy pruned since it was
          // attached does not block the request.
          await annotationStore
            .archived(id, context.documentKey)
            .catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
          return;
        }
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
      "ai:skills": (id, rootId, forceReload) =>
        ai.skills(id, rootId, forceReload),
      "ai:conversation": (id) => ai.conversation(id),
      "ai:chats": (id) => ai.chats(id),
      "ai:manage-chat": (id, action, chatId, title) =>
        ai.manageChat(id, action, chatId, title),
      "ai:review": (id, messageId) => ai.review(id, messageId),
      "ai:paper": (id, messageId) => ai.paperReview(id, messageId),
      "ai:paper-build": (id, messageId) =>
        build(id, (output, signal, confirm) =>
          ai.paperBuild(id, messageId, () =>
            core.compile(project(id), output, environment, signal, confirm),
          ),
        ),
      "ai:review-file": (id, messageId, fileId) =>
        ai.reviewFile(id, messageId, fileId),
      "ai:revert": (id, messageId, fileIds) =>
        ai.revert(id, messageId, fileIds),
      "ai:send": (request) => ai.send(request),
      "ai:queue": (request) => ai.queue(request),
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
    Menu.setApplicationMenu(
      applicationMenu((id) => win?.webContents.send("menu:command", id)),
    );
    createWindow();
    nativeTheme.on("updated", () =>
      win?.setBackgroundColor(windowBackground()),
    );
    if (
      !process.env.RESEARCH_TEST_DATA ||
      process.env.RESEARCH_TEST_FEED_NETWORK
    ) {
      // refresh() keeps the same conferences array when nothing changed.
      const refresh = async () => {
        try {
          const before = (await deadlineFeed.snapshot()).conferences;
          const result = await feedResult(true);
          if (result.feed.conferences !== before)
            send("deadlines:updated", result);
        } catch (error) {
          console.error(error.message);
        }
      };
      setTimeout(refresh, 60000).unref();
      feedTimer = setInterval(refresh, 6 * 60 * 60 * 1000);
      feedTimer.unref();
      // Runs while the app is open, including with its window closed.
      const shown = new Set();
      const reminders = createReminders(
        path.join(app.getPath("userData"), "reminders.json"),
        ({ title, body }) => {
          const notification = new Notification({ title, body });
          // Held until dismissed, so its click handler is not collected.
          shown.add(notification);
          notification.on("close", () => shown.delete(notification));
          notification.on("click", () => {
            shown.delete(notification);
            if (!win) createWindow();
            win.show();
            win.focus();
          });
          notification.show();
        },
      );
      const remind = () => {
        if (state.deadlineReminders === false || !Notification.isSupported())
          return;
        reminders.check(state).catch((error) => console.error(error.message));
      };
      setTimeout(remind, 30000).unref();
      setInterval(remind, 10 * 60 * 1000).unref();
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
