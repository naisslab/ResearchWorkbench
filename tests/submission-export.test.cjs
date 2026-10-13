const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { exportSubmission } = require("../electron/submission-export.cjs");
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "research-submission-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, "paper"),
    destination = path.join(temp, "exports");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.writeFile(
    path.join(source, "main.tex"),
    "\\documentclass{article}\\begin{document}Draft\\end{document}",
  );
  return {
    temp,
    source,
    destination,
    project: {
      name: "Paper / draft",
      folder: source,
      mainFile: "main.tex",
      latexEngine: "xelatex",
    },
  };
}
test("submission snapshot retains sources and assets, separates PDF and verifies all file hashes", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.source, "figures"));
  await fs.writeFile(path.join(f.source, "figures/plot.pdf"), "%PDF-figure");
  await fs.writeFile(
    path.join(f.source, "references.bib"),
    "@article{sample,title={Example}}",
  );
  await fs.writeFile(
    path.join(f.source, ".latexmkrc"),
    "die 'must never execute';",
  );
  await fs.mkdir(path.join(f.source, ".research-build"));
  await fs.writeFile(
    path.join(f.source, ".research-build/main.pdf"),
    "%PDF-current",
  );
  await fs.writeFile(path.join(f.source, "main.pdf"), "%PDF-older");
  const result = await exportSubmission(f.project, f.destination, {
    revision: "a".repeat(40),
    texLive: "2026",
  });
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
  assert.equal(result.files, manifest.files.length + 1);
  assert.equal(
    result.bytes,
    manifest.files.reduce((sum, item) => sum + item.bytes, 0) +
      (await fs.stat(result.manifestPath)).size,
  );
  assert.equal(manifest.mainFile, "source/main.tex");
  assert.equal(manifest.compiler, "xelatex");
  assert.equal(manifest.texLive, "2026");
  assert.equal(manifest.buildPerformed, false);
  assert.match(manifest.pdfMatchesSource, /unknown/);
  assert.equal(
    await fs.readFile(path.join(result.path, manifest.compiledPdf), "utf8"),
    "%PDF-current",
  );
  assert.ok(
    manifest.files.some((file) => file.path === "source/figures/plot.pdf"),
  );
  assert.ok(manifest.files.some((file) => file.path === "source/.latexmkrc"));
  assert.ok(!manifest.files.some((file) => file.path === "source/main.pdf"));
  for (const item of manifest.files) {
    const bytes = await fs.readFile(path.join(result.path, item.path));
    assert.equal(bytes.length, item.bytes);
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      item.sha256,
    );
  }
  assert.equal(
    await fs.readFile(path.join(f.source, "main.pdf"), "utf8"),
    "%PDF-older",
  );
  assert.deepEqual(
    (await fs.readdir(f.destination)).filter((name) =>
      name.startsWith(".research-export-"),
    ),
    [],
  );
});
test("export excludes known secrets, caches, symlinks and build files without following them", async (t) => {
  const f = await fixture(t);
  for (const name of [
    ".env",
    "credentials.json",
    "secret.key",
    "main.aux",
    "main.log",
    "id_rsa",
    "token.txt",
  ])
    await fs.writeFile(path.join(f.source, name), "DO NOT SHARE");
  for (const name of [".git", "node_modules", "editor-drafts"]) {
    await fs.mkdir(path.join(f.source, name));
    await fs.writeFile(
      path.join(f.source, name, "content.tex"),
      "DO NOT SHARE",
    );
  }
  await fs.writeFile(
    path.join(f.temp, "outside.tex"),
    "outside private content",
  );
  await fs.symlink(
    path.join(f.temp, "outside.tex"),
    path.join(f.source, "linked.tex"),
  );
  await fs.symlink(f.temp, path.join(f.source, "linked-directory"));
  const result = await exportSubmission(f.project, f.destination);
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
  assert.deepEqual(manifest.files.map((item) => item.path).sort(), [
    "README.md",
    "source/main.tex",
  ]);
  assert.equal(manifest.sourceRevision, "unknown");
  assert.equal(manifest.texLive, "unknown");
  assert.equal(manifest.compiledPdf, null);
  assert.ok(manifest.skipped.some((item) => item.path === "linked.tex"));
  assert.ok(!JSON.stringify(manifest).includes(f.source));
});
test("export rejects recursive destinations and outside entry files", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    exportSubmission(f.project, f.source),
    /outside the manuscript/,
  );
  await assert.rejects(
    exportSubmission(
      { ...f.project, mainFile: "../outside.tex" },
      f.destination,
    ),
    /inside the project/,
  );
  await fs.writeFile(path.join(f.temp, "outside.tex"), "outside");
  await fs.symlink(
    path.join(f.temp, "outside.tex"),
    path.join(f.source, "linked.tex"),
  );
  await assert.rejects(
    exportSubmission({ ...f.project, mainFile: "linked.tex" }, f.destination),
    /regular local file/,
  );
  assert.deepEqual(await fs.readdir(f.destination), []);
});
test("an entry excluded by a private directory fails without leaving a partial export", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.source, ".private"));
  await fs.writeFile(path.join(f.source, ".private/paper.tex"), "private");
  await assert.rejects(
    exportSubmission(
      { ...f.project, mainFile: ".private/paper.tex" },
      f.destination,
    ),
    /entry file was excluded/,
  );
  assert.deepEqual(await fs.readdir(f.destination), []);
});
