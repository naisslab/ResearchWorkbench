const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseProblems } = require("../src/latex.ts");

// A real latexmk run: the first pass also reports `sec:method`, which the
// second pass resolves, and latexmk's summary repeats the rest without files.
test("build problems come from the last LaTeX pass only", () => {
  const log = fs.readFileSync(
    path.join(__dirname, "fixtures", "latexmk-two-pass.log"),
    "utf8",
  );
  assert.deepEqual(parseProblems(log, "paper/main.tex"), [
    {
      file: "paper/main.tex",
      line: 3,
      message: "Citation 'smith2024-a-very-long-citation-key' undefined",
      error: false,
    },
    {
      file: "paper/sections/intro.tex",
      line: 2,
      message: "Reference 'fig:missing' undefined",
      error: false,
    },
  ]);
});
