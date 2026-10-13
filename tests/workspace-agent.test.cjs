const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const core = require("../electron/core.cjs");
const {
  fields,
  parseMutation,
  WORKSPACE_TOOLS,
  WORKSPACE_AGENT_ID,
  workspaceProject,
} = require("../electron/workspace-tools.cjs");
const { createAI } = require("../electron/ai.cjs");
const { fixture, signIn, waitFor } = require("./ai-fixtures.cjs");

const op = (entity, action, changes = {}, id = "", projectId = "") => ({
  entity,
  action,
  id,
  projectId,
  changes: {
    ...Object.fromEntries(
      Object.keys(fields[entity]).map((key) => [key, null]),
    ),
    ...changes,
  },
});
const base = () => ({
  ...core.seedWorkspace(),
  trackedDeadlines: [],
  projects: ["one", "two"].map((id) => ({
    id,
    name: id,
    areaId: core.seedWorkspace().areas[0].id,
    summary: "",
    stage: "writing",
    folder: "",
    mainFile: "",
    sshHost: "",
    venue: "",
    notes: "Keep this note",
    tasks: [],
    deadlines: [],
    updatedAt: "",
  })),
});

test("workspace mutations apply an atomic cross-project batch and preserve unrelated state", async () => {
  const { applyWorkspaceMutation } = await import("../src/workspace-agent.ts");
  const state = base();
  const input = parseMutation({
    operations: [
      op("task", "create", { text: "修改摘要" }, "", "one"),
      op(
        "milestone",
        "create",
        { label: "Draft ready", date: "2026-11-01" },
        "",
        "two",
      ),
      op("deadline", "create", {
        label: "Submit paper",
        time: "2026-11-02T10:00:00Z",
        timezone: "Asia/Hong_Kong",
        projectIds: ["one", "two"],
      }),
      op("project", "update", { stage: "submitted" }, "two"),
    ],
  });
  const { state: saved, result } = applyWorkspaceMutation(state, input);
  core.validateState(saved);
  assert.equal(result.changes.length, 4);
  assert.equal(saved.projects[0].tasks[0].text, "修改摘要");
  assert.equal(saved.projects[1].tasks.length, 0);
  assert.equal(saved.projects[1].deadlines[0].date, "2026-11-01");
  assert.equal(saved.projects[0].notes, "Keep this note");
  assert.deepEqual(saved.trackedDeadlines[0].projectIds, ["one", "two"]);
  assert.equal(state.projects[0].tasks.length, 0);
  const done = applyWorkspaceMutation(
    saved,
    parseMutation({
      operations: [
        op(
          "task",
          "update",
          { status: "done" },
          saved.projects[0].tasks[0].id,
          "one",
        ),
      ],
    }),
  ).state;
  assert.equal(done.projects[0].tasks[0].done, true);
  const bad = parseMutation({
    operations: [
      op("task", "create", { text: "Never saved" }, "", "one"),
      op("project", "update", { name: "Missing" }, "gone"),
    ],
  });
  assert.throws(() => applyWorkspaceMutation(saved, bad), /no longer exists/);
  assert.equal(saved.projects[0].tasks.length, 1);
});

test("workspace removals clean links, settings persist, and invalid targets are rejected", async () => {
  const { applyWorkspaceMutation } = await import("../src/workspace-agent.ts");
  const state = base();
  state.trackedDeadlines = [
    {
      id: "date",
      label: "D",
      subtitle: "",
      time: "2026-11-02T10:00:00Z",
      timezone: "Asia/Hong_Kong",
      category: "other",
      kind: "other",
      status: "notStarted",
      source: "manual",
      projectId: "one",
      projectIds: ["one", "two"],
    },
  ];
  state.projectOrder = ["one", "two"];
  const result = applyWorkspaceMutation(
    state,
    parseMutation({
      operations: [
        op("project", "remove", {}, "one"),
        op("settings", "update", {
          appearance: "dark",
          deadlineReminders: false,
        }),
      ],
    }),
  ).state;
  core.validateState(result);
  assert.deepEqual(result.projectOrder, ["two"]);
  assert.equal(result.trackedDeadlines[0].projectId, undefined);
  assert.deepEqual(result.trackedDeadlines[0].projectIds, ["two"]);
  assert.equal(result.appearance, "dark");
  assert.throws(
    () =>
      applyWorkspaceMutation(
        state,
        parseMutation({
          operations: [op("area", "remove", {}, state.areas[0].id)],
        }),
      ),
    /Move the area's projects/,
  );
  assert.throws(
    () =>
      parseMutation({
        operations: [
          op(
            "milestone",
            "create",
            { label: "Wrong date", date: "2026-02-30" },
            "",
            "one",
          ),
        ],
      }),
    /real milestone/,
  );
  assert.throws(
    () =>
      parseMutation({
        operations: [
          op("task", "update", { status: "blocked" }, "task", "one"),
        ],
      }),
    /reason/,
  );
  assert.throws(
    () =>
      parseMutation({
        operations: [op("deadline", "create", { time: "tomorrow" })],
      }),
    /ISO timestamp/,
  );
  assert.throws(
    () =>
      parseMutation({
        operations: [op("deadline", "create", { timezone: "not-a-zone" })],
      }),
    /timezone/,
  );
  assert.throws(
    () =>
      parseMutation({
        operations: [op("project", "update", { folder: "/private" }, "one")],
      }),
    /Invalid/,
  );
});

test("workspace runtime keeps its tools and conversation across restart, with fresh current-project context", async (t) => {
  const f = await fixture(t);
  const cwd = path.join(f.directory, "workspace-scratch");
  await fs.mkdir(cwd);
  const turns = [],
    calls = [];
  let invoke = async () => {};
  const make = () =>
    createAI({
      ...f,
      project: (id) =>
        id === WORKSPACE_AGENT_ID
          ? workspaceProject
          : { id, name: `Project ${id}`, folder: "" },
      scope: async () => ({ cwd, writableRoots: [cwd] }),
      runTool: async (name, id, input) => {
        calls.push({ name, id, input });
        return { changes: [], projects: [] };
      },
      agentFactory: () => ({
        ready: async () => {},
        close: async () => {},
        isClosed: () => false,
        listModels: async () => [
          {
            model: "fixture-model",
            displayName: "Fixture",
            supportedReasoningEfforts: [],
            serviceTiers: [],
          },
        ],
        run: async (options) => {
          turns.push(options);
          assert.deepEqual(
            options.dynamicTools.map((t) => t.name),
            WORKSPACE_TOOLS.map((t) => t.name),
          );
          assert.doesNotMatch(options.instructions.join("\n"), /latexmk/);
          await options.onThread("workspace-runtime");
          await invoke(options);
          return { status: "completed" };
        },
      }),
    });
  let client = make();
  f.cleanup(() => client.dispose());
  await signIn(client);
  await client.refreshModels();
  const send = async (context, permissionMode = "default") => {
    await client.send({
      projectId: WORKSPACE_AGENT_ID,
      workspaceContextProjectId: context,
      message: "Help with this project",
      model: "fixture-model",
      permissionMode,
    });
    await waitFor(
      async () =>
        (await client.conversation(WORKSPACE_AGENT_ID)).messages.at(-1)
          ?.status === "completed",
    );
  };
  invoke = async ({ onTool }) => {
    await onTool("get_workspace", {});
    await assert.rejects(
      onTool("record_writing_items", { tasks: ["Wrong scope"], note: "" }),
      /not available/,
    );
    await onTool("manage_workspace", {
      operations: [op("task", "create", { text: "A task" }, "", "one")],
    });
  };
  await send("one");
  const original = await client.conversation(WORKSPACE_AGENT_ID);
  assert.equal((await client.conversation("one")).messages.length, 0);
  await client.dispose();
  client = make();
  await client.refreshModels();
  invoke = async ({ onTool }) => {
    await onTool("get_workspace", {});
    await assert.rejects(
      onTool("manage_workspace", {
        operations: [op("task", "create", { text: "Forbidden" }, "", "two")],
      }),
      /Read only/,
    );
  };
  await send("two", "read-only");
  const restored = await client.conversation(WORKSPACE_AGENT_ID);
  assert.equal(restored.chatId, original.chatId);
  assert.equal(restored.threadId, original.threadId);
  assert.equal(restored.messages.length, 4);
  assert.match(turns[0].text, /Project one/);
  assert.match(turns[1].text, /Project two/);
  assert.doesNotMatch(turns[1].text, /Project one/);
  assert.equal(turns[1].savedThreadId, "workspace-runtime");
  assert.equal(calls.filter((c) => c.name === "manage_workspace").length, 1);
  assert.ok(calls.every((c) => c.id === WORKSPACE_AGENT_ID));
});

test("workspace answer citations preserve project identity and escaped source locations", () => {
  const { searchResults } = require("../electron/agent-actions.cjs");
  const packet = searchResults({
    results: [
      {
        projectId: "other project",
        projectName: "Other paper",
        kind: "pdf",
        title: "Results",
        snippet: "Measured result",
        file: "papers/result & baseline.pdf",
        rootId: "attached",
        page: 3,
        documentKey: "abc",
        version: "v1",
      },
    ],
    warnings: [],
  });
  const hit = packet.results[0];
  const reference = new URL(hit.reference, "https://workbench.local/");
  assert.equal(
    decodeURIComponent(reference.pathname.split("/")[2]),
    "other project",
  );
  assert.equal(
    reference.searchParams.get("file"),
    "papers/result & baseline.pdf",
  );
  assert.equal(reference.searchParams.get("page"), "3");
  assert.equal(reference.searchParams.get("rootId"), "attached");
  assert.equal(hit.projectName, "Other paper");
  assert.throws(
    () =>
      parseMutation({
        operations: [
          op("deadline", "create", { time: "2026-02-30T10:00:00Z" }),
        ],
      }),
    /ISO timestamp/,
  );
});
