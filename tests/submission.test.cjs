const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pdfReport, pdfReportInWorker } = require("../electron/pdf-report.cjs");
const {
  referencesLocation,
  submissionChecks,
  hidesAuthors,
} = require("../src/submission.ts");

test("the PDF report lists non-embedded and Type 3 fonts and metadata, in a worker too", async () => {
  const document = await PDFDocument.create();
  document.setAuthor("Shinan Liu");
  const page = document.addPage([612, 792]);
  page.drawText("Body", {
    font: await document.embedFont(StandardFonts.Helvetica),
  });
  document.addPage([612, 792]);
  const context = document.context;
  context.register(
    context.obj({ Type: "Font", Subtype: "Type3", BaseFont: "PlotGlyphs" }),
  );
  const descriptor = context.register(
    context.obj({
      Type: "FontDescriptor",
      FontFile2: context.register(context.obj({})),
    }),
  );
  context.register(
    context.obj({
      Type: "Font",
      Subtype: "TrueType",
      BaseFont: "ABCDEF+Embedded",
      FontDescriptor: descriptor,
    }),
  );
  const report = await pdfReport(Buffer.from(await document.save()));
  assert.deepEqual(report, {
    pages: 2,
    author: "Shinan Liu",
    title: "",
    notEmbedded: ["Helvetica"],
    type3: ["PlotGlyphs"],
  });
  const file = path.join(os.tmpdir(), `research-report-${process.pid}.pdf`);
  await fs.writeFile(file, Buffer.from(await document.save()));
  try {
    assert.deepEqual(await pdfReportInWorker(file), report);
  } finally {
    await fs.rm(file, { force: true });
  }
});

const report = (overrides = {}) => ({
  pages: 14,
  author: "",
  title: "",
  notEmbedded: [],
  type3: [],
  references: { page: 13, opensPage: false },
  ...overrides,
});
const paper = (head, body = "") => [
  {
    file: "main.tex",
    text: `${head}\n\\begin{document}\n${body}\n\\bibliography{refs}\n\\end{document}`,
  },
];

test("page limits count the body before the references", () => {
  const sources = paper("\\documentclass{article}");
  assert.deepEqual(referencesLocation(sources), { file: "main.tex", line: 4 });
  const [within] = submissionChecks(report(), sources, { pageLimit: 13 });
  assert.equal(within.status, "ok");
  assert.match(
    within.message,
    /fits in 13 of 13 pages; references start on page 13/,
  );
  const [over] = submissionChecks(report(), sources, { pageLimit: 12 });
  assert.equal(over.status, "fail");
  assert.match(over.message, /runs to page 13; the limit is 12/);
  // A bibliography at the top of page 13 leaves 12 body pages.
  const [top] = submissionChecks(
    report({ references: { page: 13, opensPage: true } }),
    sources,
    { pageLimit: 12 },
  );
  assert.equal(top.status, "ok");
  const [unknown] = submissionChecks(report({ references: null }), sources, {
    pageLimit: 12,
  });
  assert.equal(unknown.status, "warn");
  assert.equal(submissionChecks(report(), sources, {}).length, 1);
});

test("fonts and double-blind leaks are reported with their source lines", () => {
  const sources = paper(
    "\\documentclass{article}\n\\author{Shinan Liu\\thanks{UChicago}}",
    "Code: https://github.com/shinan6/tool.\n% https://github.com/hidden/comment\n\\section*{Acknowledgments}",
  );
  const checks = submissionChecks(
    report({
      author: "Shinan Liu",
      notEmbedded: ["Times-Roman"],
      type3: ["T3Font"],
    }),
    sources,
    { anonymous: true },
  );
  assert.deepEqual(
    checks.map((c) => [c.status, c.message.slice(0, 32), c.line]),
    [
      ["fail", "Fonts not embedded: Times-Roman.", undefined],
      ["warn", "Type 3 bitmap fonts, often from ", undefined],
      ["fail", "PDF metadata names the author “S", undefined],
      ["fail", "\\author names the authors.", 2],
      ["warn", "\\thanks can identify the authors", 2],
      ["warn", "https://github.com/shinan6 may i", 4],
      ["warn", "Acknowledgments usually wait unt", 6],
    ],
  );
  const clean = submissionChecks(
    report(),
    paper("\\documentclass{article}\n\\author{Anonymous Authors}"),
    { anonymous: true },
  );
  assert.deepEqual(
    clean.map((c) => c.status),
    ["ok", "ok"],
  );
  // acmart's anonymous option hides authors and acks, and turns the check on.
  const acm = paper(
    "\\documentclass[sigconf,anonymous,review]{acmart}\n\\author{Shinan Liu}",
    "\\begin{acks}Thanks\\end{acks}",
  );
  assert.equal(hidesAuthors(acm), true);
  assert.deepEqual(
    submissionChecks(report(), acm, {}).map((c) => c.status),
    ["ok", "ok"],
  );
});

test("multi-line author blocks and acknowledgment environments are caught", () => {
  const sources = paper(
    "\\documentclass{article}\n\\author{%\n  Shinan Liu \\\\\n  University of Chicago\n}",
    "\\begin{ack}\nWe thank our funders.\n\\end{ack}",
  );
  const checks = submissionChecks(report(), sources, { anonymous: true });
  assert.deepEqual(
    checks
      .filter((c) => c.status !== "ok")
      .map((c) => [c.message.slice(0, 16), c.line]),
    [
      ["\\author names th", 2],
      ["Acknowledgments ", 7],
    ],
  );
});

test("only \\author and LNCS \\authorrunning count as author names", () => {
  const leaks = (head) =>
    submissionChecks(report(), paper(`\\documentclass{llncs}\n${head}`), {
      anonymous: true,
    })
      .filter((c) => c.status !== "ok")
      .map((c) => c.message);
  assert.deepEqual(
    leaks("\\newcommand{\\authorname}{Jane}\n\\author{Anonymous}"),
    [],
  );
  assert.deepEqual(leaks("\\authorrunning{Doe et al.}\n\\author{Anonymous}"), [
    "\\authorrunning names the authors.",
  ]);
});
