const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const core = require("../electron/core.cjs");
const { manuscriptWorkspace } = require("./fixtures.cjs");
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
  const env = {
    ...process.env,
    PATH: "/Library/TeX/texbin:" + process.env.PATH,
  };
  const result = await core.compile(p, undefined, env);
  assert.equal(result.ok, true, result.log);
  const buffer = await fs.readFile(result.pdf);
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  const target = await core.synctexForward(p, "main.tex", 4, "primary", env);
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
