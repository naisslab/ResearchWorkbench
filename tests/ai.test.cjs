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
  const launched = [],
    events = [];
  const make = () =>
    createAI({
      ...f,
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
  return { ...f, client, make, projectFolder, launched, events };
}
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
  assert.equal(f.launched[0].env.ACCESS_TOKEN, "fixture-access-1-0");
  assert.equal(
    JSON.stringify(f.launched[0].args).includes("fixture-access"),
    false,
  );
  assert.match(f.launched[0].env.CODEX_HOME, /codex/);
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
  assert.equal(f.launched.length, 1);
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
