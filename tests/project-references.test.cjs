const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  resolveProjectReference,
} = require("../electron/project-references.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-reference-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manuscript = path.join(root, "Manuscript folder");
  const code = path.join(root, "Code");
  await fs.mkdir(manuscript);
  await fs.mkdir(code);
  await fs.writeFile(
    path.join(manuscript, "paper draft.tex"),
    "Line one\nLine two\n",
  );
  await fs.writeFile(path.join(code, "check.py"), "print('checked')\n");
  await fs.mkdir(path.join(manuscript, ".research-build"));
  await fs.writeFile(
    path.join(manuscript, ".research-build", "paper.pdf"),
    "%PDF-fixture",
  );
  return {
    root,
    manuscript,
    code,
    project: {
      folder: manuscript,
      localFolders: [{ id: "code", folder: code }],
    },
  };
}

test("agent file references open encoded paths, file URLs, line references, PDFs, and attached code roots", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.manuscript, "paper draft.tex");
  for (const reference of [
    encodeURI(target) + ":2",
    pathToFileURL(target).href + "#L2-L3",
    "paper%20draft.tex:2:5",
  ]) {
    const result = await resolveProjectReference(f.project, reference);
    assert.equal(result.kind, "text");
    assert.equal(result.target, await fs.realpath(target));
    assert.equal(result.rootId, "primary");
    assert.equal(result.line, 2);
  }
  assert.equal(
    (await resolveProjectReference(f.project, "check.py", "code")).rootId,
    "code",
  );
  assert.equal(
    (await resolveProjectReference(f.project, path.join(f.code, "check.py")))
      .rootId,
    "code",
  );
  assert.equal(
    (await resolveProjectReference(f.project, ".research-build/paper.pdf"))
      .kind,
    "pdf",
  );
});

test("agent file links cannot escape attached folders through traversal, absolute paths, URLs, or symlinks", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside.txt");
  await fs.writeFile(outside, "Outside the project");
  await fs.symlink(outside, path.join(f.manuscript, "escape.txt"));
  for (const reference of [
    outside,
    "../outside.txt",
    "escape.txt",
    pathToFileURL(outside).href,
    "javascript:alert(1)",
    "https://example.test/paper.pdf",
    "file://remote-host/paper.tex",
    "paper%00.tex",
  ]) {
    await assert.rejects(resolveProjectReference(f.project, reference));
  }
  await fs.writeFile(path.join(f.manuscript, "executable.command"), "echo no");
  await assert.rejects(
    resolveProjectReference(f.project, "executable.command"),
    /cannot be opened/,
  );
});
