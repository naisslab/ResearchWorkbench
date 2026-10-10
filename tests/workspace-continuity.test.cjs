const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { PDFDocument } = require("pdf-lib");
const core = require("../electron/core.cjs");
const { createSearch } = require("../electron/search.cjs");
const {
  createBackup,
  inspectBackup,
  restoreBackup,
} = require("../electron/backup.cjs");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-continuity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "data"),
    folder = path.join(root, "paper"),
    destination = path.join(root, "backup"),
    restore = path.join(root, "restore");
  for (const dir of [directory, folder, destination, restore])
    await fs.mkdir(dir);
  const workspace = await require("./fixtures.cjs").manuscriptWorkspace(folder);
  Object.assign(workspace.projects[0], {
    folder,
    mainFile: "main.tex",
    localFolders: [],
    notes: "Proof about the solar sail",
  });
  await core.atomicWrite(
    path.join(directory, "workspace.json"),
    JSON.stringify(workspace),
  );
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "An editable solar sail manuscript",
  );
  return { root, directory, folder, destination, restore, workspace };
}
test("complete backup restores exact files, annotations and chat reviews to new paths without credentials", async (t) => {
  const f = await fixture(t);
  const projectId = f.workspace.projects[0].id;
  const profile = "old-profile",
    messageId = "message-one",
    key = hash(JSON.stringify([profile, projectId]));
  const chat = {
    profileId: profile,
    projectId,
    chatId: "legacy",
    agentCwd: f.folder,
    threadId: "thread-old",
    messages: [
      { id: messageId, role: "assistant", text: "solar sail history" },
    ],
    queue: [],
  };
  const run = hash(JSON.stringify([profile, projectId, messageId]));
  await core.atomicWrite(
    path.join(f.directory, "ai/conversations", `${key}.json`),
    JSON.stringify(chat),
  );
  await core.atomicWrite(
    path.join(f.directory, "ai/changes/runs", `${run}.json`),
    JSON.stringify({
      roots: [f.folder],
      changes: [{ before: { root: f.folder } }],
    }),
  );
  await core.atomicWrite(
    path.join(f.directory, "ai/secret-credentials.json"),
    '"do-not-copy"',
  );
  await core.atomicWrite(
    path.join(f.directory, "pdf-annotations", "example.json"),
    JSON.stringify({
      projectId,
      annotations: [{ quote: "solar sail" }],
      sourcePath: path.join(f.folder, "paper.pdf"),
    }),
  );
  await fs.chmod(path.join(f.folder, "main.tex"), 0o744);
  const made = await createBackup({
    ...f,
    ui: { "research-workbench.navigation": "{}" },
  });
  assert.equal(
    made.files.some((item) => item.path.includes("credentials")),
    false,
  );
  assert.equal(
    (await inspectBackup(made.path)).workspace.projects[0].folder,
    f.folder,
  );
  await fs.writeFile(path.join(f.folder, "main.tex"), "Later user changes");
  const restored = await restoreBackup({
    bundle: made.path,
    directory: f.directory,
    destination: f.restore,
    bindProfileId: "new-profile",
  });
  const newFolder = restored.workspace.projects[0].folder;
  assert.notEqual(newFolder, f.folder);
  assert.equal(
    await fs.readFile(path.join(newFolder, "main.tex"), "utf8"),
    "An editable solar sail manuscript",
  );
  assert.equal(
    (await fs.stat(path.join(newFolder, "main.tex"))).mode & 0o777,
    0o744,
  );
  assert.equal(
    await fs.readFile(path.join(f.folder, "main.tex"), "utf8"),
    "Later user changes",
  );
  assert.equal(
    await fs.readFile(
      path.join(f.directory, "ai/secret-credentials.json"),
      "utf8",
    ),
    '"do-not-copy"',
  );
  const newKey = hash(JSON.stringify(["new-profile", projectId]));
  const saved = JSON.parse(
    await fs.readFile(
      path.join(f.directory, "ai/conversations", `${newKey}.json`),
    ),
  );
  assert.equal(saved.threadId, undefined);
  assert.equal(saved.restoredHistory, true);
  assert.equal(saved.agentCwd, newFolder);
  const newRun = hash(JSON.stringify(["new-profile", projectId, messageId]));
  const review = JSON.parse(
    await fs.readFile(
      path.join(f.directory, "ai/changes/runs", `${newRun}.json`),
    ),
  );
  assert.deepEqual(review.roots, [newFolder]);
  assert.ok(await fs.stat(path.join(restored.rollback, "workspace.json")));
});
test("corrupted and traversing backups fail before replacing the workspace", async (t) => {
  const f = await fixture(t);
  const made = await createBackup(f);
  const before = await fs.readFile(
    path.join(f.directory, "workspace.json"),
    "utf8",
  );
  await fs.writeFile(path.join(made.path, "app/workspace.json"), "corrupt");
  await assert.rejects(
    restoreBackup({
      bundle: made.path,
      directory: f.directory,
      destination: f.restore,
    }),
    /verification failed/,
  );
  assert.equal(
    await fs.readFile(path.join(f.directory, "workspace.json"), "utf8"),
    before,
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(made.path, "manifest.json")),
  );
  manifest.files[0].path = "../outside";
  await fs.writeFile(
    path.join(made.path, "manifest.json"),
    JSON.stringify(manifest),
  );
  await assert.rejects(inspectBackup(made.path), /Invalid backup file path/);
});
test("backup reports unavailable folders and skips symbolic links without following them", async (t) => {
  const f = await fixture(t);
  f.workspace.projects[0].localFolders = [
    { id: "missing", label: "Missing", folder: path.join(f.root, "missing") },
  ];
  await fs.symlink(f.directory, path.join(f.folder, "outside"));
  const made = await createBackup(f);
  assert.equal(made.skipped.length, 2);
  assert.equal(
    made.files.some((file) => file.path.includes("outside/")),
    false,
  );
  await assert.rejects(
    createBackup({ ...f, destination: f.folder }),
    /outside every attached project/,
  );
});
test("workspace search finds PDF text across spans, identifies pages and coordinates, and invalidates changed PDFs", async (t) => {
  const f = await fixture(t);
  async function pdf(text) {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]).drawText("Unrelated introduction");
    const page = doc.addPage([600, 800]);
    page.drawText(text, { x: 50, y: 640 });
    page.drawText("sail evidence", { x: 105, y: 640 });
    await fs.writeFile(path.join(f.folder, "paper.pdf"), await doc.save());
  }
  await pdf("Solar");
  const search = createSearch({
    directory: f.directory,
    workspace: () => f.workspace,
    ai: () => ({
      searchChats: async () => [
        {
          chatId: "legacy",
          title: "Experiment",
          messages: [{ id: "m", text: "Solar sail conversation" }],
        },
      ],
    }),
    emit: () => {},
  });
  t.after(() => search.dispose());
  const result = await search.search("solar sail", "one");
  const hit = result.results.find((hit) => hit.kind === "pdf");
  assert.ok(hit);
  assert.equal(hit.page, 2);
  assert.equal(hit.x, 50);
  assert.equal(hit.y, 160);
  assert.ok(result.results.some((hit) => hit.kind === "file"));
  assert.ok(result.results.some((hit) => hit.kind === "chat"));
  await pdf("Lunar");
  const next = await search.search("solar sail", "two");
  assert.equal(
    next.results.some((hit) => hit.kind === "pdf"),
    false,
  );
  const fresh = await search.search("lunar sail", "three");
  assert.ok(fresh.results.some((hit) => hit.kind === "pdf"));
});
test("annotation transfer accepts only uniquely located quotations and preserves unresolved originals", async () => {
  const { planAnnotationMigration } = await import("../src/pdf-migration.ts");
  const item = (str, x) => ({
    str,
    width: 100,
    height: 12,
    transform: [1, 0, 0, 1, x, 600],
  });
  const document = {
    numPages: 2,
    getPage: async (number) => ({
      getTextContent: async () => ({
        items:
          number === 1
            ? [item("Unique quotation", 20), item("Repeated text", 130)]
            : [item("Repeated text", 20)],
      }),
    }),
  };
  const base = {
    id: "old",
    kind: "highlight",
    page: 2,
    color: "yellow",
    quote: "Unique quotation",
    comment: "Clarify",
    createdAt: new Date().toISOString(),
    rects: [{ x: 0, y: 0, width: 1, height: 1 }],
  };
  const input = [
    base,
    { ...base, id: "ambiguous", quote: "Repeated text" },
    { ...base, id: "missing", quote: "Deleted content" },
    { ...base, id: "note", kind: "note", quote: "", position: { x: 0, y: 0 } },
  ];
  const result = await planAnnotationMigration(document, input);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].page, 1);
  assert.notEqual(result.matched[0].id, "old");
  assert.equal(result.matched[0].comment, "Clarify");
  assert.equal(result.unresolved.length, 3);
  assert.equal(input[0].page, 2);
});
test("cancelled backups remove partial bundles and keep the source intact", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(
    createBackup({
      ...f,
      signal: controller.signal,
      progress: () => controller.abort(new Error("cancelled")),
    }),
    /cancelled/,
  );
  assert.deepEqual(await fs.readdir(f.destination), []);
  assert.equal(
    await fs.readFile(path.join(f.folder, "main.tex"), "utf8"),
    "An editable solar sail manuscript",
  );
});

test("backup preserves empty directories and orphaned conversation history", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.folder, "empty/nested"), { recursive: true });
  const chat = { profileId: "old", projectId: "deleted-project", messages: [] };
  await core.atomicWrite(
    path.join(f.directory, "ai/conversations/orphan.json"),
    JSON.stringify(chat),
  );
  const made = await createBackup(f);
  const restored = await restoreBackup({
    bundle: made.path,
    directory: f.directory,
    destination: f.restore,
  });
  assert.equal(
    (
      await fs.stat(
        path.join(restored.workspace.projects[0].folder, "empty/nested"),
      )
    ).isDirectory(),
    true,
  );
  const saved = JSON.parse(
    await fs.readFile(
      path.join(f.directory, "ai/conversations/orphan.json"),
      "utf8",
    ),
  );
  assert.equal(saved.projectId, "deleted-project");
});

test("interrupted restore rolls back each swap boundary and recovery can repeat", async (t) => {
  const { recoverRestore } = require("../electron/backup.cjs");
  for (const phase of ["prepared", "moved", "installed", "recovered"]) {
    await t.test(phase, async (t) => {
      const f = await fixture(t);
      const original = await fs.readFile(
        path.join(f.directory, "workspace.json"),
        "utf8",
      );
      const rollback = await fs.mkdtemp(
        path.join(f.directory, ".before-restore-"),
      );
      const stage = await fs.mkdtemp(path.join(f.directory, ".restore-stage-"));
      await fs.writeFile(
        path.join(f.directory, ".restore-journal.json"),
        JSON.stringify({
          rollback: path.basename(rollback),
          stage: path.basename(stage),
          existing: ["workspace.json"],
        }),
      );
      if (phase === "moved" || phase === "installed")
        await fs.rename(
          path.join(f.directory, "workspace.json"),
          path.join(rollback, "workspace.json"),
        );
      if (phase === "installed") {
        await fs.writeFile(
          path.join(f.directory, "workspace.json"),
          "partially installed workspace",
        );
        await fs.mkdir(path.join(f.directory, "ai/chats"), { recursive: true });
        await fs.writeFile(
          path.join(f.directory, "ai/chats/incoming.json"),
          "{}",
        );
      }
      assert.equal(await recoverRestore(f.directory), true);
      assert.equal(
        await fs.readFile(path.join(f.directory, "workspace.json"), "utf8"),
        original,
      );
      assert.equal(
        await fs.stat(path.join(f.directory, "ai/chats")).catch(() => null),
        null,
      );
      assert.equal(await recoverRestore(f.directory), false);
    });
  }
});

test("restore failure after moving original workspace restores original bytes", async (t) => {
  const f = await fixture(t);
  const made = await createBackup(f);
  const original = await fs.readFile(path.join(f.directory, "workspace.json"));
  const rename = fs.rename;
  let injected = false;
  fs.rename = async (from, to) => {
    if (
      !injected &&
      from.includes(".restore-stage-") &&
      to === path.join(f.directory, "workspace.json")
    ) {
      injected = true;
      throw new Error("Injected disk failure");
    }
    return rename(from, to);
  };
  try {
    await assert.rejects(
      restoreBackup({
        bundle: made.path,
        directory: f.directory,
        destination: f.restore,
      }),
      /Injected disk failure/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal(injected, true);
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, "workspace.json")),
    original,
  );
  assert.equal(
    await fs
      .stat(path.join(f.directory, ".restore-journal.json"))
      .catch(() => null),
    null,
  );
});

test("overlapping project roots retain the same files after restoration", async (t) => {
  const f = await fixture(t);
  const nested = path.join(f.folder, "figures");
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, "figure.txt"), "same file");
  f.workspace.projects[0].localFolders = [
    { id: "figures", folder: nested, label: "Figures" },
  ];
  const made = await createBackup(f);
  assert.equal(
    made.files.filter((item) => item.path.endsWith("figure.txt")).length,
    1,
  );
  const restored = await restoreBackup({
    bundle: made.path,
    directory: f.directory,
    destination: f.restore,
  });
  const project = restored.workspace.projects[0];
  assert.equal(
    project.localFolders[0].folder,
    path.join(project.folder, "figures"),
  );
});
