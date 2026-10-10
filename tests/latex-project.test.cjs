const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  includes,
  readManuscript,
  manuscriptOutline,
  manuscriptLabels,
  manuscriptWords,
} = require("../src/latex-project.ts");

const files = {
  "paper/main.tex": [
    "\\documentclass{acmart}",
    "\\begin{document}",
    "\\section{Introduction}\\label{sec:intro}",
    "% \\input{sections/unused}",
    "\\input{sections/method}",
    "\\include{sections/eval} {\\bf ignored}",
    "\\subimport{appendix/}{proofs}",
    "\\input{sections/missing}",
    "\\section{Conclusion}",
    "\\end{document}",
  ].join("\n"),
  "paper/sections/method.tex": [
    "\\section{Method}",
    "We design \\method{} \\label{sec:method}.",
    "\\input{sections/method}",
    "\\subsection{Index}",
  ].join("\n"),
  "paper/sections/eval.tex": "\\section{Evaluation}\\label{fig:main}\nResults.",
  "paper/appendix/proofs.tex": "\\section{Proofs}\n\\subfile{lemma}",
  "paper/appendix/lemma.tex": "\\subsection{Lemma}\\label{lem:a}",
};
const read = async (file) =>
  files[file] === undefined ? null : { file, text: files[file] };

test("includes resolve from the entry folder, import-relative folders and comments", () => {
  assert.deepEqual(
    includes("\\input{a/b.tikz} \\include{c}", "x/y/z.tex", "x/main.tex"),
    ["x/a/b.tikz", "x/c.tex"],
  );
  assert.deepEqual(includes("% \\input{a}", "main.tex", "main.tex"), []);
  assert.deepEqual(
    includes("\\subimport{../fig}{plot}", "x/sec/a.tex", "x/main.tex"),
    ["x/fig/plot.tex"],
  );
  assert.deepEqual(
    includes("\\import{/abs/}{plot}", "main.tex", "main.tex"),
    [],
  );
});

test("a manuscript reads every included file once and outlines it in reading order", async () => {
  const sources = await readManuscript("paper/main.tex", read);
  assert.deepEqual(
    sources.map((s) => s.file),
    [
      "paper/main.tex",
      "paper/sections/method.tex",
      "paper/sections/eval.tex",
      "paper/appendix/proofs.tex",
      "paper/appendix/lemma.tex",
    ],
  );
  assert.deepEqual(
    manuscriptOutline(sources, "paper/main.tex").map((s) => [
      s.title,
      s.file,
      s.line,
    ]),
    [
      ["Introduction", "paper/main.tex", 3],
      ["Method", "paper/sections/method.tex", 1],
      ["Index", "paper/sections/method.tex", 4],
      ["Evaluation", "paper/sections/eval.tex", 1],
      ["Proofs", "paper/appendix/proofs.tex", 1],
      ["Lemma", "paper/appendix/lemma.tex", 1],
      ["Conclusion", "paper/main.tex", 9],
    ],
  );
  assert.deepEqual(Object.fromEntries(manuscriptLabels(sources)), {
    "sec:intro": { file: "paper/main.tex", line: 3 },
    "sec:method": { file: "paper/sections/method.tex", line: 2 },
    "fig:main": { file: "paper/sections/eval.tex", line: 1 },
    "lem:a": { file: "paper/appendix/lemma.tex", line: 1 },
  });
  assert.ok(manuscriptWords(sources) > 8);
  assert.equal((await readManuscript("paper/main.tex", read, 2)).length, 2);
});

test("spell checking skips inline and display math written with \\( and \\[", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "spelling.ts"),
    "utf8",
  );
  const pattern = new RegExp(/regexp:\s*\/(.+)\/g,/.exec(source)[1], "g");
  const skipped = [
    ..."Prose \\(qwerty + x\\) and \\[asdfgh\\] text".matchAll(pattern),
  ].map((m) => m[0]);
  assert.deepEqual(skipped, ["\\(qwerty + x\\)", "\\[asdfgh\\]"]);
});
