const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { files } = require("../electron/search-worker.cjs");

test("search walks build output but not the latexdiff copy of the manuscript", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-walk-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of [
    "main.tex",
    ".research-build/main.pdf",
    ".research-build/diff/diff.tex",
    ".research-build/diff/diff.pdf",
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), "x");
  }
  const found = [];
  for await (const file of files(root, new Set()))
    found.push(path.relative(root, file));
  assert.deepEqual(found.sort(), [".research-build/main.pdf", "main.tex"]);
});
