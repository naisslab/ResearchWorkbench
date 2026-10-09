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
