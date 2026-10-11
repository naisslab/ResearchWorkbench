const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, PDFName, degrees } = require("pdf-lib");
const {
  createAnnotationStore,
  validateAnnotations,
  exportAnnotated,
  digest,
} = require("../electron/pdf-annotations.cjs");
const base = {
  page: 1,
  color: "yellow",
  quote: "Research evidence",
  comment: "检查实验结果",
  createdAt: "2026-10-09T08:00:00.000Z",
};
const marks = [
  {
    ...base,
    id: "highlight-1",
    kind: "highlight",
    rects: [{ x: 50, y: 680, width: 130, height: 16 }],
  },
  { ...base, id: "note-1", kind: "note", position: { x: 240, y: 650 } },
  {
    ...base,
    id: "ink-1",
    kind: "ink",
    color: "blue",
    points: [
      { x: 40, y: 600 },
      { x: 160, y: 602 },
    ],
  },
];
async function pdf() {
  const document = await PDFDocument.create();
  document
    .addPage([600, 800])
    .drawText("Research evidence", { x: 50, y: 680, size: 16 });
  document.addPage([600, 800]).setRotation(degrees(90));
  return Buffer.from(await document.save());
}
test("annotations survive reopening, preserve the original PDF, and isolate projects and compiled versions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-pdf-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createAnnotationStore(root),
    bytes = await pdf(),
    originalHash = digest(bytes);
  const empty = await store.load("project-a", bytes, "paper.pdf", "/paper.pdf");
  assert.deepEqual(empty.annotations, []);
  await Promise.all([
    store.save(
      "project-a",
      bytes,
      "paper.pdf",
      "/paper.pdf",
      marks.slice(0, 1),
      2,
    ),
    store.save("project-a", bytes, "paper.pdf", "/paper.pdf", marks, 2),
  ]);
  assert.deepEqual(
    (
      await createAnnotationStore(root).load(
        "project-a",
        bytes,
        "paper.pdf",
        "/paper.pdf",
      )
    ).annotations,
    marks,
  );
  assert.deepEqual(
    (await store.load("project-b", bytes, "paper.pdf", "/paper.pdf"))
      .annotations,
    [],
  );
  assert.deepEqual(
    (
      await store.load(
        "project-a",
        Buffer.concat([bytes, Buffer.from("\n% revised")]),
        "paper.pdf",
        "/paper.pdf",
      )
    ).annotations,
    [],
  );
  const library = await store.library("project-a");
  assert.equal(library.length, 1);
  assert.equal(library[0].count, 3);
  const archived = await store.archived("project-a", empty.key);
  assert.equal(digest(await fs.readFile(archived.file)), originalHash);
  assert.equal(digest(bytes), originalHash);
  await assert.rejects(
    store.archived("project-b", empty.key),
    /different project/,
  );
  await assert.rejects(
    store.archived("project-a", "../workspace"),
    /identifier/,
  );
  await fs.writeFile(path.join(root, `${empty.key}.json`), "corrupted");
  await assert.rejects(
    store.load("project-a", bytes, "paper.pdf", "/paper.pdf"),
    /preserved/,
  );
});
test("export adds standard editable PDF annotations with Chinese comments and appearance streams", async () => {
  const bytes = await pdf(),
    originalHash = digest(bytes);
  const output = await exportAnnotated(bytes, marks, 2);
  const document = await PDFDocument.load(output);
  const annots = document.getPage(0).node.Annots();
  assert.equal(annots.size(), 3);
  assert.deepEqual(
    Array.from({ length: 3 }, (_, index) => {
      const dict = document.context.lookup(annots.get(index));
      assert.equal(
        dict.get(PDFName.of("Contents")).decodeText(),
        "检查实验结果",
      );
      assert.ok(dict.lookup(PDFName.of("AP")).get(PDFName.of("N")));
      return dict.get(PDFName.of("Subtype")).toString();
    }),
    ["/Highlight", "/Text", "/Ink"],
  );
  assert.equal(digest(bytes), originalHash);
  await assert.rejects(exportAnnotated(bytes, marks, 1), /version changed/);
});
test("invalid and oversized annotations cannot be stored or exported", () => {
  for (const input of [
    [{ ...marks[0], page: 3 }],
    [{ ...marks[0], color: "__proto__" }],
    [{ ...marks[0], rects: [{ x: NaN, y: 0, width: 10, height: 10 }] }],
    [{ ...marks[0], comment: "x".repeat(8001) }],
    [marks[0], marks[0]],
    [{ ...marks[2], points: [{ x: 0, y: 0 }] }],
  ])
    assert.throws(() => validateAnnotations(input, 2), /annotation|geometry/);
});
test("quit can wait for annotation saves that are still being written", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-pdf-quit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createAnnotationStore(root),
    bytes = await pdf();
  const saved = store.save(
    "project-a",
    bytes,
    "paper.pdf",
    "/paper.pdf",
    marks,
    2,
  );
  // Quit flushes right after the reader queues its last save.
  await store.flush();
  const reopened = await store.load(
    "project-a",
    bytes,
    "paper.pdf",
    "/paper.pdf",
  );
  assert.equal(reopened.annotations.length, marks.length);
  assert.equal((await saved).key, reopened.key);
});
test("at launch, superseded copies without annotations are pruned while annotated, newest and damaged copies stay", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-pdf-prune-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = async (text) => {
    const document = await PDFDocument.create();
    document.addPage([600, 800]).drawText(text, { x: 50, y: 680, size: 16 });
    return Buffer.from(await document.save());
  };
  const [first, annotated, latest, other] = await Promise.all(
    ["first", "annotated", "latest", "other"].map(version),
  );
  const compiled = "/paper/.research-build/main.pdf";
  // Copies saved during a session stay until the next launch.
  const keeper = createAnnotationStore(root);
  const keyOf = async (bytes, source = compiled) =>
    (await keeper.load("project-a", bytes, "main.pdf", source)).key;
  await keeper.save("project-a", first, "main.pdf", compiled, [], 1);
  await keeper.save(
    "project-a",
    annotated,
    "main.pdf",
    compiled,
    [marks[0]],
    1,
  );
  await keeper.save("project-a", other, "notes.pdf", "/notes.pdf", [], 1);
  await keeper.flush();
  // Damaged records are neither listed nor removed.
  const damaged = ["d".repeat(64), "e".repeat(64)];
  await fs.writeFile(path.join(root, `${damaged[0]}.json`), "null");
  await fs.writeFile(
    path.join(root, `${damaged[1]}.json`),
    JSON.stringify({
      key: damaged[1],
      projectId: "project-a",
      sourcePath: compiled,
      updatedAt: "2020-01-01T00:00:00Z",
    }),
  );
  await fs.writeFile(path.join(root, `${damaged[1]}.pdf`), "%PDF");
  // A copy whose record is gone is reclaimed at startup.
  await fs.writeFile(path.join(root, `${"f".repeat(64)}.pdf`), "%PDF");
  assert.equal((await keeper.library("project-a")).length, 3);

  await keeper.save("project-a", latest, "main.pdf", compiled, [], 1);
  await keeper.flush();
  assert.equal((await keeper.library("project-a")).length, 4);
  // The next launch prunes.
  const store = createAnnotationStore(root);
  await store.pruneAll();
  await store.idle();
  const kept = new Set(await fs.readdir(root));
  const [firstKey, annotatedKey, latestKey, otherKey] = await Promise.all([
    keyOf(first),
    keyOf(annotated),
    keyOf(latest),
    keyOf(other, "/notes.pdf"),
  ]);
  assert.ok(!kept.has(`${firstKey}.pdf`) && !kept.has(`${firstKey}.json`));
  for (const key of [annotatedKey, latestKey, otherKey])
    assert.ok(kept.has(`${key}.pdf`) && kept.has(`${key}.json`), key);
  for (const key of damaged) assert.ok(kept.has(`${key}.json`), key);

  // Annotating an old copy again does not make it the newest version.
  await keeper.save("project-a", annotated, "main.pdf", compiled, [], 1);
  await keeper.flush();
  await store.pruneAll();
  const after = new Set(await fs.readdir(root));
  assert.ok(after.has(`${latestKey}.pdf`));
  assert.ok(!after.has(`${annotatedKey}.pdf`));
  assert.ok(!after.has(`${"f".repeat(64)}.pdf`));
  assert.ok(after.has(`${damaged[1]}.pdf`));
});

test("feedback status survives storage, old annotations stay open, and invalid status is rejected", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-feedback-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createAnnotationStore(root),
    bytes = await pdf();
  const feedback = marks.map((mark, i) =>
    i === 0 ? { ...mark, resolved: true } : mark,
  );
  await store.save("p", bytes, "paper.pdf", "/paper.pdf", feedback, 2);
  const read = await createAnnotationStore(root).load(
    "p",
    bytes,
    "paper.pdf",
    "/paper.pdf",
  );
  assert.equal(read.annotations[0].resolved, true);
  assert.equal(read.annotations[1].resolved, undefined);
  assert.throws(
    () => validateAnnotations([{ ...marks[0], resolved: "yes" }], 2),
    /status/,
  );
});
test("agent replies survive the reader's saves, end with their annotation, and list as project feedback", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-pdf-reply-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createAnnotationStore(root),
    bytes = await pdf();
  const { key } = await store.save(
    "project-a",
    bytes,
    "paper.pdf",
    "/paper.pdf",
    marks,
    2,
  );
  await assert.rejects(
    store.reply("project-b", key, "note-1", "Rewrote the claim."),
    /not part of the project/,
  );
  await assert.rejects(
    store.reply("project-a", key, "missing", "Rewrote the claim."),
    /no longer exists/,
  );
  const replies = await store.reply(
    "project-a",
    key,
    "note-1",
    "Rewrote the claim in sec. 3.",
  );
  assert.equal(replies["note-1"].note, "Rewrote the claim in sec. 3.");
  // The reader saves every annotation whole, including a resolved one.
  const resolved = marks.map((m) =>
    m.id === "highlight-1" ? { ...m, resolved: true } : m,
  );
  await store.save("project-a", bytes, "paper.pdf", "/paper.pdf", resolved, 2);
  const loaded = await store.load(
    "project-a",
    bytes,
    "paper.pdf",
    "/paper.pdf",
  );
  assert.equal(
    loaded.agentReplies["note-1"].note,
    "Rewrote the claim in sec. 3.",
  );
  const [record] = await store.records("project-a");
  assert.equal(record.key, key);
  assert.deepEqual(
    record.annotations.map((a) => [a.id, !!a.resolved]),
    [
      ["highlight-1", true],
      ["note-1", false],
      ["ink-1", false],
    ],
  );
  assert.deepEqual(await store.records("project-b"), []);
  await store.save(
    "project-a",
    bytes,
    "paper.pdf",
    "/paper.pdf",
    marks.filter((m) => m.id !== "note-1"),
    2,
  );
  assert.deepEqual(
    (await store.load("project-a", bytes, "paper.pdf", "/paper.pdf"))
      .agentReplies,
    {},
  );
});
