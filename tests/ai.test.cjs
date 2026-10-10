const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createAI } = require("../electron/ai.cjs");
const {
  createCodexAgent,
  agentArguments,
} = require("../electron/codex-agent.cjs");
const { fixture, signIn, waitFor } = require("./ai-fixtures.cjs");

async function clientFixture(t) {
  const f = await fixture(t);
  const projectFolder = path.join(f.directory, "project");
  await fs.mkdir(projectFolder);
  await fs.writeFile(path.join(projectFolder, "draft.tex"), "Old manuscript\n");
  const skillRoot = path.join(f.directory, "skills");
  const skillPath = path.join(skillRoot, "scale-writing", "SKILL.md");
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(
    skillPath,
    "---\nname: scale-writing\ndescription: Revise research writing using paper exemplars.\n---\nPreserve supported claims.\n",
  );
  const launched = [],
    events = [];
  const make = () =>
    createAI({
      ...f,
      skillRoots: [skillRoot],
      project: (id) => {
        if (!["one", "two"].includes(id)) throw new Error("Unknown project");
        return { id, name: id, stage: "writing", folder: projectFolder };
      },
      scope: async () => ({
        cwd: projectFolder,
        writableRoots: [projectFolder],
      }),
      validateContext: async () => {},
      emit: (channel, value) =>
        events.push({ channel, value: structuredClone(value) }),
      agentFactory: (options) =>
        createCodexAgent({
          ...options,
          executable: process.execPath,
          spawnProcess: (_file, args, config) => {
            launched.push({ args, env: config.env });
            return spawn(
              process.execPath,
              [path.join(__dirname, "fake-codex-server.cjs")],
              config,
            );
          },
        }),
    });
  const client = make();
  f.cleanup(() => client.dispose());
  await signIn(client);
  await client.refreshModels();
  return { ...f, client, make, projectFolder, skillPath, launched, events };
}
test("installed skills are discovered locally, invoked as native skill inputs, and recorded without private paths", async (t) => {
  const f = await clientFixture(t);
  const catalog = await f.client.skills("one", "primary", true);
  assert.equal(catalog.skills[0].name, "scale-writing");
  assert.equal(catalog.skills[0].enabled, true);
  assert.equal(catalog.warnings, 0);
  assert.equal("path" in catalog.skills[0], false);
  assert.equal(f.launched[0].env.ACCESS_TOKEN, "");
  const selected = catalog.skills[0];
  await f.client.send({
    projectId: "one",
    message: "Revise this paper",
    model: "fixture-model",
    rootId: "primary",
    skillIds: [selected.id],
  });
  const completed = await waitFor(async () => {
    const chat = await f.client.conversation("one");
    return chat.messages.at(-1)?.status === "completed" ? chat : false;
  });
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(f.projectFolder, "received-skills.json"),
        "utf8",
      ),
    ),
    [{ type: "skill", name: "scale-writing", path: f.skillPath }],
  );
  assert.deepEqual(completed.messages[0].skills, [
    { name: "scale-writing", displayName: "scale-writing" },
  ]);
  assert.equal(JSON.stringify(completed).includes(f.skillPath), false);
  assert.equal(
    f.events
      .filter((e) => e.channel === "conversation")
      .some((e) => JSON.stringify(e.value).includes(f.skillPath)),
    false,
  );
  const restarted = f.make();
  f.cleanup(() => restarted.dispose());
  assert.deepEqual(
    (await restarted.conversation("one")).messages[0].skills,
    completed.messages[0].skills,
  );
});
test("missing and invalid skill selections fail before inference and preserve the draft history", async (t) => {
  const f = await clientFixture(t);
  const selected = (await f.client.skills("one", "primary")).skills[0];
  const request = {
    projectId: "one",
    message: "Revise this paper",
    model: "fixture-model",
    rootId: "primary",
  };
  await assert.rejects(
    f.client.send({ ...request, skillIds: ["/tmp/arbitrary/SKILL.md"] }),
    { code: "invalid_skills" },
  );
  await assert.rejects(
    f.client.send({ ...request, skillIds: [selected.id, selected.id] }),
    { code: "invalid_skills" },
  );
  await fs.rm(f.skillPath);
  await assert.rejects(f.client.send({ ...request, skillIds: [selected.id] }), {
    code: "skill_unavailable",
  });
  assert.equal((await f.client.conversation("one")).messages.length, 0);
  assert.equal(
    f.launched.length,
    1,
    "Only the offline metadata process should start",
  );
});
test("the subscribed agent modifies multiple files, executes a script, streams Unicode, records usage, and resumes its thread", async (t) => {
  const f = await clientFixture(t);
  assert.deepEqual(
    (await f.client.getState()).models.map((m) => m.slug),
    ["fixture-model", "fixture-model-2"],
  );
  await f.client.send({
    projectId: "one",
    message: "Edit the manuscript and run checks",
    model: "fixture-model",
    rootId: "primary",
  });
  const finished = await waitFor(async () => {
    const c = await f.client.conversation("one");
    return c.messages.at(-1)?.status === "completed" ? c : false;
  });
  assert.equal(finished.messages.at(-1).text, "修改完成。");
  assert.equal(
    await fs.readFile(path.join(f.projectFolder, "draft.tex"), "utf8"),
    "Revised manuscript\n",
  );
  assert.match(
    await fs.readFile(path.join(f.projectFolder, "check.cjs"), "utf8"),
    /fixture checks/,
  );
  const command = finished.messages
    .at(-1)
    .activities.find((item) => item.type === "commandExecution");
  assert.equal(command.exitCode, 0);
  assert.match(command.output, /fixture checks passed/);
  assert.equal(
    finished.messages
      .at(-1)
      .activities.find((item) => item.type === "fileChange").changes.length,
    2,
  );
  assert.match(finished.messages.at(-1).diff, /Revised manuscript/);
  assert.deepEqual(finished.messages.at(-1).usage, {
    inputTokens: 100,
    outputTokens: 50,
  });
  const state = await f.client.getState();
  assert.equal(state.usage.requests, 1);
  assert.equal(state.usage.inputTokens, 100);
  assert.equal(f.launched[1].env.ACCESS_TOKEN, "fixture-access-1-0");
  assert.equal(
    JSON.stringify(f.launched[1].args).includes("fixture-access"),
    false,
  );
  assert.match(f.launched[1].env.CODEX_HOME, /codex/);
  await f.client.send({
    projectId: "one",
    message: "Run checks again",
    model: "fixture-model-2",
    rootId: "primary",
  });
  await waitFor(
    async () =>
      (await f.client.conversation("one")).messages.at(-1)?.status ===
      "completed",
  );
  assert.equal(f.launched.length, 2);
  assert.equal((await f.client.getState()).usage.inputTokens, 200);
  const second = await f.client.conversation("two");
  assert.equal(second.messages.length, 0);
  const restarted = f.make();
  f.cleanup(() => restarted.dispose());
  const restored = await restarted.conversation("one");
  assert.equal(restored.messages.length, 4);
  assert.equal(restored.threadId, finished.threadId);
  assert.equal(restored.agentRootId, "primary");
  await restarted.clear("one");
  assert.equal((await restarted.conversation("one")).threadId, undefined);
  assert.equal((await restarted.conversation("one")).agentRootId, undefined);
});
test("permission, reasoning, and speed selections reach new, active, and resumed RPC threads", async (t) => {
  const f = await clientFixture(t);
  const models = (await f.client.getState()).models;
  assert.equal(models[0].defaultReasoningEffort, "medium");
  assert.equal(models[0].serviceTiers[0].id, "priority");
  assert.equal(models[1].supportedReasoningEfforts.length, 1);
  async function send(client, settings) {
    await client.send({
      projectId: "one",
      message: "Check the manuscript",
      rootId: "primary",
      model: "fixture-model",
      ...settings,
    });
    await waitFor(
      async () =>
        (await client.conversation("one")).messages.at(-1)?.status ===
        "completed",
    );
    return JSON.parse(
      await fs.readFile(
        path.join(f.projectFolder, "received-agent-settings.json"),
        "utf8",
      ),
    );
  }
  const first = await send(f.client, {
    permissionMode: "auto-review",
    reasoningEffort: "xhigh",
    serviceTier: "priority",
  });
  assert.equal(first.thread.approvalsReviewer, "auto_review");
  assert.equal(first.thread.serviceTier, "priority");
  assert.equal(first.turn.approvalsReviewer, "auto_review");
  assert.equal(first.turn.effort, "xhigh");
  assert.equal(first.turn.serviceTierForTurn, "priority");
  assert.deepEqual(first.turn.sandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: [f.projectFolder],
    networkAccess: false,
  });
  const full = await send(f.client, {
    permissionMode: "full-access",
    reasoningEffort: "low",
  });
  assert.equal(full.turn.approvalPolicy, "never");
  assert.deepEqual(full.turn.sandboxPolicy, { type: "dangerFullAccess" });
  assert.equal(full.turn.serviceTier, "default");
  assert.equal(full.turn.serviceTierForTurn, "default");
  const read = await send(f.client, { permissionMode: "read-only" });
  assert.deepEqual(read.turn.sandboxPolicy, { type: "readOnly" });
  assert.equal(read.turn.approvalPolicy, "on-request");
  assert.equal(read.turn.approvalsReviewer, "user");
  assert.equal(read.turn.effort, "medium");
  await f.client.dispose();
  const restarted = f.make();
  f.cleanup(() => restarted.dispose());
  await restarted.refreshModels();
  const resumed = await send(restarted, {
    permissionMode: "default",
    reasoningEffort: "xhigh",
  });
  assert.equal(resumed.thread.threadId, first.turn.threadId);
  assert.equal(resumed.thread.sandbox, "workspace-write");
  assert.equal(resumed.thread.approvalsReviewer, "user");
  assert.equal(resumed.turn.effort, "xhigh");
  const restored = await restarted.conversation("one");
  assert.equal(restored.messages.at(-1).permissionMode, "default");
  assert.equal(restored.messages.at(-1).reasoningEffort, "xhigh");
  assert.equal(restored.messages.at(-1).serviceTier, "default");
});
test("invalid agent controls are rejected before a turn or history write", async (t) => {
  const f = await clientFixture(t);
  const request = {
    projectId: "one",
    message: "Check files",
    model: "fixture-model-2",
    rootId: "primary",
  };
  for (const [settings, code] of [
    [{ permissionMode: "anything" }, "invalid_permissions"],
    [{ reasoningEffort: "xhigh" }, "invalid_reasoning_effort"],
    [{ reasoningEffort: "invented" }, "invalid_reasoning_effort"],
    [{ serviceTier: "priority" }, "invalid_service_tier"],
    [{ serviceTier: "invented" }, "invalid_service_tier"],
  ])
    await assert.rejects(f.client.send({ ...request, ...settings }), { code });
  assert.equal((await f.client.conversation("one")).messages.length, 0);
  assert.equal(f.launched.length, 1, "Only the offline catalog process starts");
});
test("approval remains pending until the user decides and cannot be replayed", async (t) => {
  const f = await clientFixture(t);
  await f.client.send({
    projectId: "one",
    message: "request-approval",
    model: "fixture-model",
    rootId: "primary",
  });
  const request = await waitFor(
    async () =>
      (await f.client.conversation("one")).messages.at(-1)?.approvals?.[0],
  );
  assert.equal(request.command, "node check.cjs");
  assert.equal(
    await fs.readFile(path.join(f.projectFolder, "draft.tex"), "utf8"),
    "Old manuscript\n",
  );
  await f.client.answer({
    projectId: "one",
    id: request.id,
    decision: "accept",
  });
  await waitFor(
    async () =>
      (await f.client.conversation("one")).messages.at(-1)?.status ===
      "completed",
  );
  await assert.rejects(
    f.client.answer({ projectId: "one", id: request.id, decision: "accept" }),
    { code: "approval_expired" },
  );
});
test("cancellation interrupts the RPC turn and preserves project isolation", async (t) => {
  const f = await clientFixture(t);
  await f.client.send({
    projectId: "one",
    message: "wait-for-stop",
    model: "fixture-model",
    rootId: "primary",
  });
  await waitFor(() => f.launched.length);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const canceled = await f.client.stop("one");
  assert.equal(canceled.messages.at(-1).status, "cancelled");
  await signIn(f.client, { newProfile: true });
  assert.equal((await f.client.conversation("one")).messages.length, 0);
});
test("agent configuration uses subscribed Responses with the local Code Mode host", () => {
  const args = agentArguments().join(" ");
  assert.match(args, /https:\/\/api.openai.com\/v1/);
  assert.match(args, /supports_websockets=false/);
  assert.match(args, /features.code_mode_host=true/);
  assert.doesNotMatch(args, /features.code_mode(?:_only)?=false/);
  assert.match(args, /features.image_generation=false/);
  assert.doesNotMatch(args, /backend-api/);
});

test("concurrent submissions queue in FIFO order with their captured settings and private context", async (t) => {
  const f = await clientFixture(t);
  const request = {
    projectId: "one",
    model: "fixture-model",
    rootId: "primary",
  };
  await f.client.send({ ...request, message: "request-approval" });
  const approval = await waitFor(
    async () =>
      (await f.client.conversation("one")).messages.at(-1)?.approvals?.[0],
  );
  const skill = (await f.client.skills("one", "primary")).skills[0];
  await Promise.all([
    f.client.send({
      ...request,
      message: "Queued first",
      reasoningEffort: "xhigh",
      serviceTier: "priority",
      permissionMode: "auto-review",
      skillIds: [skill.id],
      context: {
        kind: "file",
        file: "draft.tex",
        rootId: "primary",
        text: "private attachment snapshot",
      },
    }),
    f.client.send({
      ...request,
      message: "Queued second",
      model: "fixture-model-2",
      reasoningEffort: "low",
    }),
    f.client.send({
      ...request,
      message: "Queued third",
      reasoningEffort: "medium",
    }),
  ]);
  const pending = await f.client.conversation("one");
  assert.deepEqual(
    pending.queue.map((item) => item.text),
    ["Queued first", "Queued second", "Queued third"],
  );
  assert.equal(pending.messages.length, 2);
  assert.equal(pending.queue[0].skills[0].name, "scale-writing");
  assert.equal(
    JSON.stringify(pending).includes("private attachment snapshot"),
    false,
  );
  assert.equal(JSON.stringify(pending).includes(f.skillPath), false);
  assert.equal((await f.client.conversation("two")).queue.length, 0);
  await f.client.answer({
    projectId: "one",
    id: approval.id,
    decision: "accept",
  });
  const completed = await waitFor(async () => {
    const chat = await f.client.conversation("one");
    return chat.messages.length === 8 &&
      chat.messages.at(-1).status === "completed"
      ? chat
      : false;
  });
  assert.equal(completed.queue.length, 0);
  assert.deepEqual(
    completed.messages.filter((m) => m.role === "user").map((m) => m.text),
    ["request-approval", "Queued first", "Queued second", "Queued third"],
  );
  const turns = (
    await fs.readFile(
      path.join(f.projectFolder, "received-turns.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(turns.length, 4);
  assert.equal(turns[1].effort, "xhigh");
  assert.equal(turns[1].serviceTierForTurn, "priority");
  assert.equal(turns[1].approvalsReviewer, "auto_review");
  assert.match(turns[1].input[0].text, /private attachment snapshot/);
  assert.equal(turns[1].input[1].type, "skill");
  assert.equal(turns[2].model, "fixture-model-2");
  assert.equal((await f.client.getState()).usage.requests, 4);
});

test("queue controls reorder and remove pending requests; Stop pauses and Resume continues", async (t) => {
  const f = await clientFixture(t);
  const request = {
    projectId: "one",
    model: "fixture-model",
    rootId: "primary",
  };
  await f.client.send({ ...request, message: "wait-for-stop" });
  await f.client.send({ ...request, message: "First" });
  await f.client.send({ ...request, message: "Second" });
  await f.client.send({ ...request, message: "Remove me" });
  let chat = await f.client.conversation("one");
  await f.client.queue({
    projectId: "one",
    action: "move",
    id: chat.queue[1].id,
    direction: -1,
  });
  await f.client.queue({
    projectId: "one",
    action: "remove",
    id: chat.queue[2].id,
  });
  chat = await f.client.stop("one");
  assert.equal(chat.queuePaused, true);
  assert.equal(chat.messages.at(-1).status, "cancelled");
  assert.deepEqual(
    chat.queue.map((item) => item.text),
    ["Second", "First"],
  );
  assert.equal(f.client.isRunning("one"), false);
  await f.client.send({ ...request, message: "Added while paused" });
  assert.equal((await f.client.conversation("one")).messages.length, 2);
  await f.client.queue({ projectId: "one", action: "resume" });
  await waitFor(async () => {
    const c = await f.client.conversation("one");
    return c.messages.length === 8 && c.messages.at(-1).status === "completed";
  });
  assert.deepEqual(
    (await f.client.conversation("one")).messages
      .filter((m) => m.role === "user")
      .map((m) => m.text),
    ["wait-for-stop", "Second", "First", "Added while paused"],
  );
  await assert.rejects(
    f.client.queue({
      projectId: "one",
      action: "remove",
      id: chat.queue[0].id,
    }),
    { code: "queue_item_expired" },
  );
});

test("pausing the queue lets the current turn finish without starting the next request", async (t) => {
  const f = await clientFixture(t);
  const request = {
    projectId: "one",
    model: "fixture-model",
    rootId: "primary",
  };
  await f.client.send({ ...request, message: "request-approval" });
  const approval = await waitFor(
    async () =>
      (await f.client.conversation("one")).messages.at(-1)?.approvals?.[0],
  );
  await f.client.send({ ...request, message: "Next request" });
  await f.client.queue({ projectId: "one", action: "pause" });
  await f.client.answer({
    projectId: "one",
    id: approval.id,
    decision: "accept",
  });
  const paused = await waitFor(async () => {
    const c = await f.client.conversation("one");
    return c.messages.at(-1).status === "completed" ? c : false;
  });
  assert.equal(paused.messages.length, 2);
  assert.equal(paused.queue.length, 1);
  assert.equal(paused.queuePaused, true);
  assert.equal(f.client.isRunning("one"), false);
  await f.client.queue({ projectId: "one", action: "resume" });
  await waitFor(async () => {
    const c = await f.client.conversation("one");
    return c.messages.length === 4 && c.messages.at(-1).status === "completed";
  });
});

test("restored queues wait for Resume, revalidate skills, and pause after a failed turn", async (t) => {
  const f = await clientFixture(t);
  const request = {
    projectId: "one",
    model: "fixture-model",
    rootId: "primary",
  };
  const skill = (await f.client.skills("one", "primary")).skills[0];
  await f.client.send({ ...request, message: "wait-for-stop" });
  await f.client.send({
    ...request,
    message: "Revise with skill",
    skillIds: [skill.id],
  });
  await f.client.send({ ...request, message: "fixture-failure" });
  await f.client.send({ ...request, message: "After failure" });
  await f.client.dispose();
  const restarted = f.make();
  f.cleanup(() => restarted.dispose());
  await restarted.refreshModels();
  let restored = await restarted.conversation("one");
  assert.equal(restored.queuePaused, true);
  assert.equal(restored.queue.length, 3);
  assert.equal(restarted.isRunning("one"), false);
  await fs.rm(f.skillPath);
  await restarted.queue({ projectId: "one", action: "resume" });
  restored = await waitFor(async () => {
    const c = await restarted.conversation("one");
    return c.queueError ? c : false;
  });
  assert.equal(restored.queueError.code, "skill_unavailable");
  assert.equal(restored.queuePaused, true);
  assert.equal(restored.messages.length, 2);
  await restarted.queue({
    projectId: "one",
    action: "remove",
    id: restored.queue[0].id,
  });
  await restarted.queue({ projectId: "one", action: "resume" });
  restored = await waitFor(async () => {
    const c = await restarted.conversation("one");
    return c.messages.at(-1).status === "failed" ? c : false;
  });
  assert.equal(restored.queuePaused, true);
  assert.equal(restored.queue[0].text, "After failure");
  await restarted.clear("one");
  assert.equal((await restarted.conversation("one")).queue.length, 0);
});

test("queue size is bounded and account switching preserves a paused isolated queue", async (t) => {
  const f = await clientFixture(t);
  const request = {
    projectId: "one",
    model: "fixture-model",
    rootId: "primary",
  };
  const profile = (await f.client.getState()).activeProfileId;
  await f.client.send({ ...request, message: "wait-for-stop" });
  for (let i = 0; i < 20; i++)
    await f.client.send({ ...request, message: `Queued ${i}` });
  await assert.rejects(f.client.send({ ...request, message: "Overflow" }), {
    code: "queue_full",
  });
  await signIn(f.client, { newProfile: true });
  assert.equal((await f.client.conversation("one")).queue.length, 0);
  await f.client.selectProfile(profile);
  const restored = await f.client.conversation("one");
  assert.equal(restored.queue.length, 20);
  assert.equal(restored.queuePaused, true);
  assert.equal(restored.messages.at(-1).status, "cancelled");
});
