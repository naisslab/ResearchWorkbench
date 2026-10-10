const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBibliography,
  describeEntry,
  citations,
  bibliographyProblems,
  referenceKey,
  rekeyEntry,
} = require("../src/bibliography.ts");

const bib = String.raw`@string{neurips = "NeurIPS"}
% A comment line
@inproceedings{lewis2020rag,
  title     = {Retrieval-Augmented Generation for Knowledge-Intensive {NLP} Tasks},
  author    = {Lewis, Patrick and Perez, Ethan and Piktus, Aleksandra and Petroni, Fabio},
  booktitle = neurips,
  year      = 2020,
  month     = dec
}

@article{ quoted ,
  title = "Nested {Braces} and \"Escapes\"",
  author = "Rockt{\"a}schel, Tim",
  journal = {TACL},
  year = {2021},
}
@misc{lewis2020rag, title = {Duplicate}}
`;

test("BibTeX entries keep keys, types, lines, nested braces and bare values", () => {
  const entries = parseBibliography(bib, "refs.bib");
  assert.deepEqual(
    entries.map((e) => [e.key, e.type, e.line]),
    [
      ["lewis2020rag", "inproceedings", 3],
      ["quoted", "article", 11],
      ["lewis2020rag", "misc", 17],
    ],
  );
  assert.equal(
    entries[0].fields.title,
    "Retrieval-Augmented Generation for Knowledge-Intensive {NLP} Tasks",
  );
  assert.deepEqual(entries[0].bare, ["booktitle", "year", "month"]);
  assert.equal(entries[1].fields.title, 'Nested {Braces} and \\"Escapes\\"');
  assert.equal(
    describeEntry(entries[0]),
    "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks · Lewis, Perez, Piktus et al. · neurips 2020",
  );
});

test("bibliography problems report duplicates, missing and unused entries once", () => {
  const entries = [
    ...parseBibliography(bib, "refs.bib"),
    ...parseBibliography(
      "@misc{unused1, title={A}}\n@misc{unused2, title={B}}",
      "extra.bib",
    ),
  ];
  const sources = [
    {
      file: "main.tex",
      text: "Text \\citep[see][p.~3]{lewis2020rag, quoted}.\n% \\cite{commented}\n\\cite{missing} \\cite{logged}",
    },
  ];
  assert.deepEqual(
    [...citations(sources).keys()],
    ["lewis2020rag", "quoted", "missing", "logged"],
  );
  const problems = bibliographyProblems(entries, sources, [
    {
      file: "main.tex",
      line: 3,
      message: "Citation 'logged' undefined",
      error: false,
    },
  ]);
  assert.deepEqual(
    problems.map((p) => [p.message, `${p.file}:${p.line}`]),
    [
      ["Duplicate BibTeX key 'lewis2020rag' (also refs.bib:3)", "refs.bib:17"],
      ["Citation 'missing' is not in any .bib file", "main.tex:3"],
      ["2 BibTeX entries are never cited: unused1, unused2", "extra.bib:1"],
    ],
  );
  const everything = [{ file: "main.tex", text: "\\nocite{*}" }];
  assert.equal(bibliographyProblems(entries, everything).length, 1);
});

test("new references get readable unique keys and a tidy entry", () => {
  const fields = {
    title: "The {RAG} Approach: Retrieval for Everyone",
    author: "Küttler, Heinrich and Lewis, Mike",
    year: "2020",
  };
  assert.equal(referenceKey(fields, new Set()), "kuttler2020rag");
  assert.equal(
    referenceKey(fields, new Set(["kuttler2020rag", "kuttler2020raga"])),
    "kuttler2020ragb",
  );
  assert.equal(referenceKey({}, new Set()), "ref");
  const entry = rekeyEntry(
    "@misc{https://doi.org/10.48550/arxiv.2005.11401,\n doi = {10.48550/ARXIV.2005.11401},\n keywords = {x},\n title = {T},\n month = jan,\n year = {2020}\n}",
    () => "lewis2020t",
  );
  assert.equal(
    entry,
    "@misc{lewis2020t,\n  doi   = {10.48550/ARXIV.2005.11401},\n  title = {T},\n  month = jan,\n  year  = {2020}\n}\n",
  );
  assert.throws(() => rekeyEntry("<html>", () => "x"), /no BibTeX entry/);
});

test("citation scanning handles natbib and biblatex forms without phantom keys", () => {
  const sources = [
    {
      file: "main.tex",
      text: [
        "\\setcitestyle{authoryear,round}\\citestyle{acmauthoryear}",
        "\\newcommand{\\mycite}[1]{\\cite{#1}}",
        "\\Citet{upper} and \\citeauthor*{author}",
        "\\parencites[see][12]{one}(pre)(post){two}{three} \\citetext{not a key}",
        "\\cite{first,",
        "  second} \\nocite{*}",
      ].join("\n"),
    },
  ];
  assert.deepEqual(
    [...citations(sources)].map(([key, at]) => `${key}@${at.line}`),
    [
      "upper@3",
      "author@3",
      "one@4",
      "two@4",
      "three@4",
      "first@5",
      "second@5",
      "*@6",
    ],
  );
});

test("bibliography files resolve relative names and inline \\bibitem keys count as defined", () => {
  const { bibliographyFiles } = require("../src/useBibliography.ts");
  const root = {
    id: "primary",
    files: ["refs.bib", "paper/local.bib", "old/unused.bib", "paper/main.tex"],
  };
  const named = (text) =>
    bibliographyFiles(
      [{ file: "paper/main.tex", text }],
      "paper/main.tex",
      root,
    ).files;
  assert.deepEqual(named("\\bibliography{../refs,./local}"), [
    "refs.bib",
    "paper/local.bib",
  ]);
  assert.deepEqual(
    named("% \\bibliography{commented}\n\\addbibresource{local.bib}"),
    ["paper/local.bib"],
  );
  assert.deepEqual(named("no bibliography command"), [
    "refs.bib",
    "paper/local.bib",
    "old/unused.bib",
  ]);
  // Named files outside the project's list block the citation checks.
  const outside = bibliographyFiles(
    [
      {
        file: "paper/main.tex",
        text: "\\cite{x}\n\\bibliography{local,../../shared/lib}\n\\addbibresource{/Users/me/Zotero.bib}",
      },
    ],
    "paper/main.tex",
    root,
  );
  assert.deepEqual(outside.files, ["paper/local.bib"]);
  // Two levels up from paper/ is outside the project, not the root refs.bib.
  assert.deepEqual(named("\\bibliography{../../refs}"), []);
  assert.deepEqual(
    outside.missing.map((m) => [m.message.split(" ")[0], m.line]),
    [
      ["../../shared/lib.bib", 2],
      ["/Users/me/Zotero.bib", 3],
    ],
  );
  const inline = [
    {
      file: "main.tex",
      text: "\\cite{a,b}\n\\begin{thebibliography}{1}\\bibitem{a} A.\\bibitem[B]{b} B.\\end{thebibliography}",
    },
  ];
  assert.deepEqual(bibliographyProblems([], inline), []);
  assert.deepEqual(bibliographyProblems(null, inline), []);
  assert.deepEqual(
    bibliographyProblems([], [{ file: "main.tex", text: "\\cite{x}" }]),
    [],
  );
});

test("declarations and volume citations are not keys, and keys match regardless of case", () => {
  const sources = [
    {
      file: "main.tex",
      text: "\\newcites{suppl}{Supplementary}\\volcite{2}{k1}\n\\cite{Smith2020}",
    },
  ];
  assert.deepEqual([...citations(sources).keys()], ["Smith2020"]);
  const entries = parseBibliography(
    "@article{smith2020, title={A}}\n@misc{SMITH2020, title={B}}",
    "refs.bib",
  );
  assert.deepEqual(
    bibliographyProblems(entries, sources).map((p) => p.message),
    ["Duplicate BibTeX key 'SMITH2020' (also refs.bib:1)"],
  );
});

test("a new entry follows existing text after exactly one blank line", () => {
  const { appendEntry } = require("../src/bibliography.ts");
  const entry = "@misc{a, title={A}}\n";
  assert.equal(appendEntry("", entry), entry);
  assert.equal(appendEntry("@misc{b}", entry), "@misc{b}\n\n" + entry);
  assert.equal(appendEntry("@misc{b}\n", entry), "@misc{b}\n\n" + entry);
  assert.equal(appendEntry("@misc{b}\n\n", entry), "@misc{b}\n\n" + entry);
});

test("generated keys avoid existing keys that differ only in case", () => {
  const { referenceKey, foldKey } = require("../src/bibliography.ts");
  const fields = { title: "Retrieval", author: "Lewis, Patrick", year: "2020" };
  assert.equal(
    referenceKey(fields, new Set([foldKey("Lewis2020Retrieval")])),
    "lewis2020retrievala",
  );
});

test("an unreadable .bib is reported and pauses citation checks instead of flagging every key", () => {
  const sources = [{ file: "main.tex", text: "\\cite{big2024,local}" }];
  const entries = parseBibliography("@misc{local, title={A}}", "local.bib");
  assert.deepEqual(
    bibliographyProblems(
      entries,
      sources,
      [],
      [{ file: "big.bib", message: "big.bib could not be read" }],
    ).map((p) => p.message),
    ["big.bib could not be read"],
  );
});

test("BibTeX from Crossref is made safe for LaTeX: entities, ampersands and month names", () => {
  const entry = rekeyEntry(
    "@inproceedings{Liu_2019, title={Graphs &amp; Text &#8211; R&D}, booktitle={KDD &amp; Data Mining}, url={https://x.org/?a=1&amp;b=2}, month=July, year={2019}}",
    () => "liu2019graphs",
  );
  assert.match(entry, /title {5}= \{Graphs \\& Text – R\\&D\}/);
  assert.match(entry, /booktitle = \{KDD \\& Data Mining\}/);
  assert.match(entry, /url {7}= \{https:\/\/x\.org\/\?a=1&b=2\}/);
  assert.match(entry, /month {5}= jul,/);
  assert.doesNotMatch(entry, /&amp;/);
});
