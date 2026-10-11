const test = require("node:test");
const assert = require("node:assert/strict");
const { TOOLS } = require("../electron/agent-tools.cjs");
const { createWindowTools } = require("../electron/window-tools.cjs");
const tool = (name) => TOOLS.find((t) => t.name === name);

test("writing captures append to the current project and retries do not duplicate tasks or notes", async () => {
  const { applyWritingCapture } = await import("../src/window-tools.ts");
  const source = {
    projects: [
      {
        id: "one",
        tasks: [{ id: "existing", text: "Check references", done: false }],
        notes: "Existing observation",
      },
      { id: "two", tasks: [], notes: "Other project" },
    ],
  };
  const capture = tool("record_writing_items").parse({
    tasks: ["check references", " 改写摘要 ", "改写摘要"],
    note: "把贡献写清楚",
  });
  const saved = applyWritingCapture(source, "one", capture);
  assert.equal(saved.projects[0].tasks.length, 2);
  assert.equal(saved.projects[0].notes, "Existing observation\n\n把贡献写清楚");
  assert.deepEqual(saved.projects[1], source.projects[1]);
  const repeated = applyWritingCapture(saved, "one", capture);
  assert.deepEqual(repeated.projects[0].tasks, saved.projects[0].tasks);
  assert.equal(repeated.projects[0].notes, saved.projects[0].notes);
  assert.equal(source.projects[0].tasks.length, 1);
  assert.throws(
    () => applyWritingCapture(source, "missing", capture),
    /no longer exists/,
  );
  assert.throws(() =>
    tool("record_writing_items").parse({ tasks: [], note: "" }),
  );
  assert.throws(() =>
    tool("record_writing_items").parse({
      tasks: ["x"],
      note: "",
      projectId: "other",
    }),
  );
});

test("project updates change only named to-dos, the stage and new milestones", async () => {
  const { applyProjectUpdate } = await import("../src/window-tools.ts");
  const parse = tool("update_project").parse;
  const source = {
    projects: [
      {
        id: "one",
        stage: "writing",
        tasks: [
          { id: "a", text: "Revise abstract", done: false, pinned: true },
          { id: "b", text: "Run ablation", done: false, blocked: "GPU" },
          { id: "c", text: "Check figures", done: true },
        ],
        deadlines: [
          { id: "d", label: "Paper", date: "2026-11-01", kind: "submission" },
        ],
      },
    ],
  };
  const update = parse({
    tasks: [
      { id: "a", status: "done", reason: "" },
      { id: "b", status: "open", reason: "" },
      { id: "c", status: "blocked", reason: "Waiting for new plots" },
    ],
    stage: "submitted",
    milestones: [
      { label: "Paper", date: "2026-11-01", kind: "submission" },
      { label: "Rebuttal", date: "2027-01-10", kind: "revision" },
    ],
  });
  const { state, result } = applyProjectUpdate(source, "one", update);
  assert.deepEqual(result, { tasks: 3, stage: "submitted", milestones: 1 });
  const [project] = state.projects;
  assert.deepEqual(project.tasks, [
    { id: "a", text: "Revise abstract", done: true, pinned: true },
    { id: "b", text: "Run ablation", done: false },
    {
      id: "c",
      text: "Check figures",
      done: false,
      blocked: "Waiting for new plots",
    },
  ]);
  assert.equal(project.stage, "submitted");
  assert.deepEqual(
    project.deadlines.map((d) => d.label),
    ["Paper", "Rebuttal"],
  );
  assert.throws(
    () =>
      applyProjectUpdate(
        source,
        "one",
        parse({
          tasks: [{ id: "zzz", status: "done", reason: "" }],
          stage: "",
          milestones: [],
        }),
      ),
    /No to-do has id zzz/,
  );
  for (const input of [
    { tasks: [], stage: "", milestones: [] },
    {
      tasks: [{ id: "a", status: "blocked", reason: "" }],
      stage: "",
      milestones: [],
    },
    { tasks: [], stage: "done", milestones: [] },
    {
      tasks: [],
      stage: "",
      milestones: [{ label: "x", date: "2026-02-30", kind: "other" }],
    },
  ])
    assert.throws(() => parse(input));
});

test("window tools report success only after the window confirms, and abort releases pending calls", async () => {
  let request;
  const bridge = createWindowTools((value) => {
    request = value;
  });
  const controller = new AbortController();
  const first = bridge.request(
    "project",
    "record_writing_items",
    { tasks: ["Check citations"], note: "" },
    controller.signal,
  );
  assert.equal(request.projectId, "project");
  assert.equal(request.tool, "record_writing_items");
  assert.equal(bridge.complete("unknown", { ok: true, result: {} }), false);
  bridge.complete(request.id, { ok: true, result: { saved: true } });
  assert.equal((await first).saved, true);
  const failed = bridge.request(
    "project",
    "update_project",
    {},
    controller.signal,
  );
  bridge.complete(request.id, { ok: false, error: "No to-do has id x." });
  await assert.rejects(failed, /No to-do has id x/);
  const second = bridge.request(
    "project",
    "check_submission",
    {},
    controller.signal,
  );
  const rejected = assert.rejects(second, /stopped/);
  controller.abort();
  await rejected;
  assert.equal(bridge.complete(request.id, { ok: true }), false);
  const late = bridge.request(
    "project",
    "check_submission",
    {},
    new AbortController().signal,
    10,
  );
  await assert.rejects(late, /did not respond/);
});
