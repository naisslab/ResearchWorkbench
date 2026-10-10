const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const core = require("../electron/core.cjs");
const { manuscriptWorkspace } = require("./fixtures.cjs");
// The app's own PATH, which adds the MacTeX tools.
const env = require("../electron/environment.cjs");
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "research-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test("new workspace has research areas without placeholder projects or files", async (t) => {
  const root = await temporary(t);
  const state = await core.seedWorkspace();
  assert.deepEqual(state.projects, []);
  assert.deepEqual(
    state.areas.map((a) => a.name),
    ["ML Systems", "Security and Privacy", "Cyber-Physical Systems"],
  );
  core.validateState(state);
  const file = path.join(root, "workspace.json");
  await core.atomicWrite(file, JSON.stringify(state));
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), state);
  assert.deepEqual(await fs.readdir(root), ["workspace.json"]);
});
test("atomic replacement preserves binary bytes and cleans up after a failed rename", async (t) => {
  const root = await temporary(t);
  const file = path.join(root, "document.pdf");
  await core.atomicWrite(file, "previous contents");
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  await core.atomicWrite(file, bytes);
  assert.deepEqual(await fs.readFile(file), bytes);
  const blocked = path.join(root, "existing-folder");
  await fs.mkdir(blocked);
  await fs.writeFile(path.join(blocked, "manuscript.tex"), "Keep this source");
  await assert.rejects(core.atomicWrite(blocked, "replacement"));
  assert.equal(
    await fs.readFile(path.join(blocked, "manuscript.tex"), "utf8"),
    "Keep this source",
  );
  assert.deepEqual((await fs.readdir(root)).sort(), [
    "document.pdf",
    "existing-folder",
  ]);
});
test("project file access rejects traversal and symlinks outside the project", async (t) => {
  const root = await temporary(t);
  const project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "main.tex"), "hello");
  await fs.writeFile(path.join(root, "outside.tex"), "private");
  await fs.symlink(
    path.join(root, "outside.tex"),
    path.join(project, "linked.tex"),
  );
  assert.equal(
    await core.safeFile(project, "main.tex"),
    await fs.realpath(path.join(project, "main.tex")),
  );
  await assert.rejects(core.safeFile(project, "../outside.tex"), /inside/);
  await assert.rejects(core.safeFile(project, "linked.tex"), /inside/);
  await assert.rejects(
    core.safeFile(project, path.join(root, "outside.tex")),
    /relative/,
  );
});
test("new file paths stay in existing folders inside the project and reject parent or hidden names", async (t) => {
  const root = await temporary(t);
  const project = path.join(root, "project");
  await fs.mkdir(path.join(project, "sections"), { recursive: true });
  await fs.symlink(root, path.join(project, "escape"));
  const canonical = await fs.realpath(project);
  assert.equal(
    await core.safeNewPath(project, "intro.tex"),
    path.join(canonical, "intro.tex"),
  );
  assert.equal(
    await core.safeNewPath(project, "sections/intro.tex"),
    path.join(canonical, "sections", "intro.tex"),
  );
  for (const name of [
    "../outside.tex",
    "sections/../../outside.tex",
    ".hidden.tex",
    "sections/.git/config.tex",
    "/absolute.tex",
    "sections//intro.tex",
    "back\\slash.tex",
    "",
    undefined,
  ])
    await assert.rejects(core.safeNewPath(project, name), /simple names/);
  await assert.rejects(core.safeNewPath(project, "escape/x.tex"), /inside/);
  await assert.rejects(
    core.safeNewPath(project, "missing/x.tex"),
    /does not exist/,
  );
});
test("file listing excludes dependencies, build artifacts, and symlinks", async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, "sections"));
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "main.tex"), "");
  await fs.writeFile(path.join(root, "sections", "intro.tex"), "");
  await fs.writeFile(path.join(root, "node_modules", "skip.tex"), "");
  await fs.writeFile(path.join(root, "paper.pdf"), "");
  assert.deepEqual(await core.listFiles(root), [
    "main.tex",
    path.join("sections", "intro.tex"),
  ]);
});
test("saving a script keeps its execute permission", async (t) => {
  const root = await temporary(t);
  const script = path.join(root, "run.sh");
  await fs.writeFile(script, "echo old\n", { mode: 0o755 });
  await fs.chmod(script, 0o755);
  await core.atomicWrite(script, "echo new\n");
  assert.equal((await fs.stat(script)).mode & 0o777, 0o755);
  assert.equal(await fs.readFile(script, "utf8"), "echo new\n");
});
test("an unreadable subfolder does not hide the rest of the project", async (t) => {
  const root = await temporary(t);
  const locked = path.join(root, "locked");
  await fs.mkdir(locked);
  await fs.writeFile(path.join(locked, "secret.tex"), "");
  await fs.writeFile(path.join(root, "main.tex"), "");
  await fs.chmod(locked, 0);
  try {
    assert.deepEqual(await core.listFiles(root), ["main.tex"]);
  } finally {
    // Cleanup runs later and needs to read the folder.
    await fs.chmod(locked, 0o755);
  }
  await assert.rejects(core.listFiles(path.join(root, "missing")));
});
test("a folder deeper than the tree limit is reported as truncated", async (t) => {
  const root = await temporary(t);
  const deep = path.join(root, ...Array.from({ length: 8 }, (_, i) => `d${i}`));
  await fs.mkdir(deep, { recursive: true });
  await fs.writeFile(path.join(root, "main.tex"), "");
  await fs.writeFile(path.join(deep, "hidden.tex"), "");
  const [listing] = await core.projectFiles({ folder: root, mainFile: "" });
  assert.deepEqual(listing.files, ["main.tex"]);
  assert.equal(listing.truncated, true);
  await fs.rm(path.join(root, "d0"), { recursive: true });
  assert.equal(
    (await core.projectFiles({ folder: root, mainFile: "" }))[0].truncated,
    false,
  );
});
test("SSH targets support aliases and user@host and reject options or command text", () => {
  assert.deepEqual(core.sshArgs("research-server"), ["research-server"]);
  assert.deepEqual(core.sshArgs("alice@cluster.example.edu"), [
    "alice@cluster.example.edu",
  ]);
  for (const host of [
    "-oProxyCommand=whoami",
    "host;whoami",
    "host $(whoami)",
    "",
    "host\ncommand",
  ])
    assert.throws(() => core.sshArgs(host), /SSH/);
});
test("invalid imports fail before replacing a workspace", async (t) => {
  const state = await manuscriptWorkspace(await temporary(t));
  assert.throws(() => core.validateState({ ...state, version: 2 }), /version/);
  assert.throws(
    () =>
      core.validateState({
        ...state,
        projects: [{ ...state.projects[0], stage: "invented" }],
      }),
    /Invalid project/,
  );
  const malicious = structuredClone(state);
  malicious.projects[0].deadlines.push({
    id: "d",
    label: "deadline",
    date: "2026-11-01",
    kind: "submission",
    url: "javascript:alert(1)",
  });
  assert.throws(() => core.validateState(malicious), /HTTP/);
});
test("LaTeX compilation creates a real PDF, maps lines with SyncTeX and reports document errors", async (t) => {
  const root = await temporary(t);
  const state = await manuscriptWorkspace(root);
  const p = state.projects[0];
  const result = await core.compile(p, undefined, env);
  assert.equal(result.ok, true, result.log);
  const buffer = await fs.readFile(result.pdf);
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  const target = await core.synctexForward(p, "main.tex", 4, "primary", env);
  const sourceMapPath = result.pdf.replace(/\.pdf$/, ".synctex.gz");
  const sourceMap = await fs.readFile(sourceMapPath);
  assert.equal(target.page, 1);
  assert.deepEqual(
    await core.synctexInverse(p, target.page, target.x, target.y, env),
    { file: "main.tex", rootId: "primary", line: 4 },
  );
  await fs.writeFile(
    path.join(p.folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nFirst page.\\newpage\n\\undefinedResearchCommand\n\\end{document}",
  );
  const failed = await core.compile(p, undefined, env);
  assert.equal(failed.ok, false);
  assert.equal(failed.pdf, null);
  assert.match(failed.log, /Undefined control sequence/);
  assert.deepEqual(
    await fs.readFile(result.pdf),
    buffer,
    "The last successful PDF must survive a failed build.",
  );
  assert.deepEqual(await fs.readFile(sourceMapPath), sourceMap);
  assert.deepEqual(
    await core.synctexInverse(p, target.page, target.x, target.y, env),
    { file: "main.tex", rootId: "primary", line: 4 },
    "The previous PDF must retain its matching source map after a failed build.",
  );
});

test("the entry file's TeX program comment selects XeLaTeX and keeps SyncTeX", async (t) => {
  const folder = await temporary(t);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "% !TEX program = xelatex\n\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\nUnicode text.\n\\end{document}\n",
  );
  const project = { folder, mainFile: "main.tex", localFolders: [] };
  const result = await core.compile(project, undefined, env);
  assert.equal(result.ok, true, result.log);
  assert.match(
    await fs.readFile(result.pdf.replace(/\.pdf$/, ".log"), "utf8"),
    /^This is XeTeX/,
  );
  assert.match(result.log, /^Engine: XeLaTeX \(% !TEX program\)\n/);
  assert.ok(await core.synctexForward(project, "main.tex", 5, "primary", env));
  const invalid = structuredClone(await manuscriptWorkspace(folder));
  invalid.projects[0].latexEngine = "latex";
  assert.throws(() => core.validateState(invalid), /LaTeX engine/);
});
test("a project latexmkrc runs only after the user trusts it", async (t) => {
  const folder = await temporary(t);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}\n",
  );
  const marker = path.join(folder, "rc-ran");
  await fs.writeFile(
    path.join(folder, "latexmkrc"),
    `system("touch", ${JSON.stringify(marker)});\n`,
  );
  const project = { folder, mainFile: "main.tex", localFolders: [] };
  const asked = [];
  const declined = await core.compile(
    project,
    undefined,
    env,
    undefined,
    async (config) => {
      asked.push(config);
      return false;
    },
  );
  assert.equal(declined.ok, true, declined.log);
  assert.match(
    declined.log,
    /^Engine: pdfLaTeX \(default\); latexmkrc skipped/,
  );
  await assert.rejects(
    fs.access(marker),
    "An untrusted latexmkrc must not run",
  );
  assert.deepEqual(
    asked.map((config) => config.files),
    [["latexmkrc"]],
  );
  assert.match(asked[0].hash, /^[a-f0-9]{64}$/);
  await core.compile(project, undefined, env, undefined, async () => true);
  await fs.access(marker);
  await assert.rejects(
    core.compile(project, undefined, env, undefined, async () => {
      throw new Error("Build canceled.");
    }),
    /canceled/,
  );
});
test("SyncTeX locates included files on later pages through project paths with spaces and symlinks", async (t) => {
  const root = await temporary(t);
  const folder = path.join(root, "paper with spaces");
  await fs.mkdir(path.join(folder, "sections"), { recursive: true });
  await fs.writeFile(
    path.join(folder, "main.tex"),
    String.raw`\documentclass{article}
\begin{document}
Overview text on page one.
\newpage
\input{sections/details}
\end{document}
`,
  );
  await fs.writeFile(
    path.join(folder, "sections", "details.tex"),
    "\\section{Details}\n\nDistinct included text on page two.\n",
  );
  const linked = path.join(root, "linked paper");
  await fs.symlink(folder, linked);
  const project = { folder: linked, mainFile: "main.tex", localFolders: [] };
  const result = await core.compile(project, undefined, env);
  assert.equal(result.ok, true, result.log);
  const target = await core.synctexForward(
    project,
    "sections/details.tex",
    3,
    "primary",
    env,
  );
  assert.equal(target.page, 2);
  assert.deepEqual(
    await core.synctexInverse(project, target.page, target.x, target.y, env),
    {
      file: "sections/details.tex",
      rootId: "primary",
      line: 3,
    },
  );
  for (const position of [
    [0, 1, 1],
    [1.5, 1, 1],
    [1, NaN, 1],
    [1, 1, Infinity],
    [1, -1, 1],
  ])
    await assert.rejects(
      core.synctexInverse(project, ...position, env),
      /Invalid PDF position/,
    );
  assert.equal(await core.synctexInverse(project, 9999, 10, 10, env), null);
  await assert.rejects(
    core.synctexInverse(project, target.page, target.x, target.y, {
      ...env,
      PATH: path.join(root, "missing-tools"),
    }),
    /synctex is missing/,
  );
});

test("project file roots include manuscript and code and reject unknown attachments", async (t) => {
  const root = await temporary(t);
  const paper = path.join(root, "paper"),
    code = path.join(root, "code");
  await fs.mkdir(paper);
  await fs.mkdir(code);
  await fs.writeFile(path.join(paper, "main.tex"), "draft");
  await fs.writeFile(path.join(code, "train.py"), "print('hello')");
  const project = {
    folder: paper,
    mainFile: "main.tex",
    localFolders: [
      { id: "code", label: "Code", folder: code },
      { id: "notes", label: "Notes", folder: path.join(root, "missing") },
    ],
  };
  const roots = await core.projectFiles(project);
  assert.deepEqual(
    roots.slice(0, 2).map((r) => [r.label, r.files]),
    [
      ["Manuscript", ["main.tex"]],
      ["Code", ["train.py"]],
    ],
  );
  assert.ok(roots[2].error);
  assert.equal(core.fileRoot(project, "code"), code);
  assert.throws(
    () => core.fileRoot(project, "arbitrary"),
    /no longer attached/,
  );
  await assert.rejects(
    core.safeFile(core.fileRoot(project, "code"), "../paper/main.tex"),
    /inside/,
  );
});
