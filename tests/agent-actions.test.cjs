const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const core = require("../electron/core.cjs");
const env = require("../electron/environment.cjs");
const { createAnnotationStore } = require("../electron/pdf-annotations.cjs");
const {
  projectDetails,
  listFeedback,
  buildResult,
  compileForAgent,
} = require("../electron/agent-actions.cjs");

test("project details carry the stage, venue, limits and linked dates", () => {
  const p = {
    id: "paper",
    name: "Paper",
    summary: "Does retrieval help?",
    stage: "writing",
    venue: "NeurIPS",
    pageLimit: 9,
    anonymousReview: true,
    mainFile: "main.tex",
    deadlines: [{ id: "m", label: "Draft", date: "2026-11-01", kind: "other" }],
  };
  const details = projectDetails(
    {
      projects: [p],
      trackedDeadlines: [
        { id: "a", label: "NeurIPS paper", projectIds: ["paper"], time: "x" },
        { id: "b", label: "Older link", projectId: "paper", time: "y" },
        { id: "c", label: "Other project", projectIds: ["other"], time: "z" },
      ],
    },
    p,
  );
  assert.equal(details.targetVenue, "NeurIPS");
  assert.equal(details.pageLimit, 9);
  assert.equal(details.anonymousReview, true);
  assert.deepEqual(details.milestones, [
    { label: "Draft", date: "2026-11-01", kind: "other" },
  ]);
  assert.deepEqual(
    details.conferenceDates.map((d) => d.label),
    ["NeurIPS paper", "Older link"],
  );
});

test("compile results list problems relative to the project, and the log only when nothing was parsed", async () => {
  const p = { folder: "/work/paper", mainFile: "main.tex" };
  const failed = await buildResult(
    p,
    {
      ok: false,
      log: "./main.tex:4: Undefined control sequence.\n",
      pdf: null,
    },
    true,
  );
  assert.deepEqual(failed.problems, [
    {
      file: "main.tex",
      line: 4,
      message: "Undefined control sequence.",
      error: true,
    },
  ]);
  assert.match(failed.note, /latexmkrc is not trusted/);
  assert.equal(failed.log, undefined);
  const crashed = await buildResult(
    p,
    { ok: false, log: "latexmk: command not found", pdf: null },
    false,
  );
  assert.match(crashed.log, /not found/);
  const built = await buildResult(
    p,
    { ok: true, log: "", pdf: "/work/paper/.research-build/main.pdf" },
    false,
  );
  assert.equal(built.pdf, ".research-build/main.pdf");
});

test("feedback on the compiled PDF maps to its source line; older versions and resolved items follow the filter", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "research-feedback-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nFirst paragraph about retrieval.\n\n\\newpage\nSecond page claim.\n\\end{document}\n",
  );
  const p = { id: "paper", folder, mainFile: "main.tex", localFolders: [] };
  const built = await core.compile(p, undefined, env);
  assert.equal(built.ok, true, built.log);
  const store = createAnnotationStore(path.join(folder, "store"));
  const bytes = await fs.readFile(built.pdf);
  const mark = {
    kind: "note",
    color: "yellow",
    quote: "",
    createdAt: "2026-10-11T08:00:00.000Z",
  };
  // US Letter: the first line of text sits about 1.75 inches from the top.
  const { key } = await store.save(
    p.id,
    bytes,
    "main.pdf",
    built.pdf,
    [
      {
        ...mark,
        id: "one",
        page: 1,
        comment: "Clarify",
        position: { x: 160, y: 665 },
      },
      {
        ...mark,
        id: "two",
        page: 2,
        comment: "Cite this",
        position: { x: 160, y: 665 },
        resolved: true,
      },
    ],
    2,
  );
  await store.save(
    p.id,
    Buffer.from("%PDF-1.4 older"),
    "main.pdf",
    built.pdf,
    [
      {
        ...mark,
        id: "old",
        page: 1,
        comment: "Earlier draft note",
        position: { x: 1, y: 1 },
      },
    ],
    1,
  );
  await store.reply(p.id, key, "one", "Rewrote the first paragraph.");
  const open = (await listFeedback(store, p, "open", env)).feedback;
  const current = open.find((item) => item.id === "one");
  assert.deepEqual(current.source, { file: "main.tex", line: 3 });
  assert.equal(current.agentReply, "Rewrote the first paragraph.");
  assert.equal(current.current, true);
  const old = open.find((item) => item.id === "old");
  assert.equal(old.current, false);
  assert.equal(old.source, undefined);
  assert.ok(!open.some((item) => item.id === "two"));
  const all = (await listFeedback(store, p, "all", env)).feedback;
  assert.deepEqual(all.find((item) => item.id === "two").source, {
    file: "main.tex",
    line: 6,
  });
});

test("the agent's build shares the build slot, skips an untrusted latexmkrc, and reports to the workbench", async (t) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "research-agent-build-"),
  );
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nSee \\cite{missing}.\n\\undefinedcommand\n\\end{document}\n",
  );
  const marker = path.join(folder, "rc-ran");
  await fs.writeFile(
    path.join(folder, "latexmkrc"),
    `system("touch", ${JSON.stringify(marker)});\n`,
  );
  const p = { id: "paper", folder, mainFile: "main.tex", localFolders: [] };
  const builds = new Map(),
    events = [];
  let streamed = "";
  const deps = {
    builds,
    environment: env,
    trusted: async () => false,
    output: Object.assign((text) => (streamed += text), { flush() {} }),
    events: (event) => events.push(event),
  };
  builds.set("paper", new AbortController());
  await assert.rejects(
    compileForAgent(p, deps, new AbortController().signal),
    /already compiling/,
  );
  builds.clear();
  const failed = await compileForAgent(p, deps, new AbortController().signal);
  assert.equal(failed.ok, false);
  assert.ok(
    failed.problems.some((x) => x.line === 4 && x.error),
    JSON.stringify(failed.problems),
  );
  assert.match(failed.note, /latexmkrc is not trusted/);
  await assert.rejects(
    fs.access(marker),
    "An untrusted latexmkrc must not run",
  );
  assert.equal(builds.size, 0);
  assert.deepEqual(
    events.map((e) => e.running),
    [true, false],
  );
  assert.equal(events[1].ok, false);
  assert.match(events[1].log, /Undefined control sequence/);
  assert.match(streamed, /Undefined control sequence/);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nFixed.\n\\end{document}\n",
  );
  const fixed = await compileForAgent(
    p,
    { ...deps, trusted: async () => true },
    new AbortController().signal,
  );
  assert.deepEqual(fixed.problems, []);
  assert.equal(fixed.pdf, path.join(".research-build", "main.pdf"));
  assert.equal(fixed.note, undefined);
  await fs.access(marker);
  assert.equal(
    events.at(-1).pdf,
    path.join(await fs.realpath(folder), ".research-build", "main.pdf"),
  );
});
