// Test-only RPC fixture. No model inference or network requests occur.
const readline = require("node:readline");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
let threadId = "fixture-thread",
  turnId = 0,
  tokens = 0,
  pending;
let skillRoots = [];
let threadSettings;
async function work(params) {
  const current = `fixture-turn-${turnId}`;
  const notification = (method, data) =>
    send({ method, params: { threadId, turnId: current, ...data } });
  const text = params.input[0].text;
  if (params.input.some((item) => item.type === "skill"))
    await fs.writeFile(
      path.join(params.cwd, "received-skills.json"),
      JSON.stringify(params.input.filter((item) => item.type === "skill")),
    );
  if (text.includes("wait-for-stop")) {
    pending = { current, params };
    return;
  }
  if (text.includes("fixture-failure")) {
    notification("turn/completed", {
      turn: {
        id: current,
        status: "failed",
        error: { message: "Fixture failure" },
      },
    });
    return;
  }
  if (text.includes("request-approval") && !params.approved) {
    pending = { current, params };
    send({
      id: "fixture-approval",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: current,
        itemId: "command",
        command: "node check.cjs",
        cwd: params.cwd,
        reason: "Fixture execution approval",
        availableDecisions: ["accept", "decline", "cancel"],
      },
    });
    return;
  }
  await fs.writeFile(
    path.join(params.cwd, "draft.tex"),
    "Revised manuscript\n",
  );
  await fs.writeFile(
    path.join(params.cwd, "check.cjs"),
    "console.log('fixture checks passed')\n",
  );
  notification("item/started", {
    item: {
      id: "command",
      type: "commandExecution",
      command: "node check.cjs",
      cwd: params.cwd,
      status: "inProgress",
    },
  });
  const result = await run(process.execPath, ["check.cjs"], {
    cwd: params.cwd,
  });
  notification("item/commandExecution/outputDelta", {
    itemId: "command",
    delta: result.stdout,
  });
  notification("item/completed", {
    item: {
      id: "command",
      type: "commandExecution",
      command: "node check.cjs",
      cwd: params.cwd,
      status: "completed",
      aggregatedOutput: result.stdout,
      exitCode: 0,
    },
  });
  const changes = [
    {
      path: path.join(params.cwd, "draft.tex"),
      kind: { type: "update" },
      diff: "-Old manuscript\n+Revised manuscript",
    },
    {
      path: path.join(params.cwd, "check.cjs"),
      kind: { type: "add" },
      diff: "+console.log('fixture checks passed')",
    },
  ];
  notification("item/completed", {
    item: { id: "files", type: "fileChange", status: "completed", changes },
  });
  notification("turn/diff/updated", {
    diff: "--- draft.tex\n+++ draft.tex\n-Old manuscript\n+Revised manuscript",
  });
  const encoded = Buffer.from(
    JSON.stringify({
      method: "item/agentMessage/delta",
      params: {
        threadId,
        turnId: current,
        itemId: "reply",
        delta: "修改完成。",
      },
    }) + "\n",
  );
  const position = encoded.indexOf(Buffer.from("修")) + 1;
  process.stdout.write(encoded.subarray(0, position));
  setTimeout(() => {
    process.stdout.write(encoded.subarray(position));
    notification("item/completed", {
      item: { id: "reply", type: "agentMessage", text: "修改完成。" },
    });
    tokens += 100;
    notification("thread/tokenUsage/updated", {
      tokenUsage: {
        total: { inputTokens: tokens, outputTokens: tokens / 2 },
        last: { inputTokens: 100, outputTokens: 50 },
      },
    });
    notification("turn/completed", {
      turn: { id: current, status: "completed" },
    });
  }, 10);
}
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.id === "fixture-approval" && message.result) {
    send({
      method: "serverRequest/resolved",
      params: { threadId, requestId: message.id },
    });
    if (message.result.decision === "accept")
      await work({ ...pending.params, approved: true });
    else
      send({
        method: "turn/completed",
        params: {
          threadId,
          turn: { id: pending.current, status: "interrupted" },
        },
      });
    pending = undefined;
    return;
  }
  if (message.method === "initialize")
    send({ id: message.id, result: { userAgent: "fixture" } });
  else if (message.method === "model/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            model: "fixture-model",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Lighter reasoning" },
              { reasoningEffort: "medium", description: "Balanced reasoning" },
              { reasoningEffort: "xhigh", description: "Deep reasoning" },
            ],
            serviceTiers: [
              {
                id: "priority",
                name: "Fast",
                description: "Faster responses, increased usage",
              },
            ],
          },
          {
            model: "fixture-model-2",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Lighter reasoning" },
            ],
            serviceTiers: [],
          },
        ],
        nextCursor: null,
      },
    });
  } else if (message.method === "skills/extraRoots/set") {
    skillRoots = message.params.extraRoots;
    send({ id: message.id, result: {} });
  } else if (message.method === "skills/list") {
    const skillPath = path.join(skillRoots[0], "scale-writing", "SKILL.md");
    const enabled = await fs.access(skillPath).then(
      () => true,
      () => false,
    );
    send({
      id: message.id,
      result: {
        data: message.params.cwds.map((cwd) => ({
          cwd,
          skills: [
            {
              name: "scale-writing",
              description: "Revise research writing using paper exemplars.",
              path: skillPath,
              scope: "user",
              enabled,
              pluginId: null,
            },
          ],
          errors: [],
        })),
      },
    });
  } else if (
    message.method === "thread/start" ||
    message.method === "thread/resume"
  ) {
    threadSettings = message.params;
    threadId = message.params.threadId || threadId;
    send({ id: message.id, result: { thread: { id: threadId } } });
  } else if (message.method === "turn/start") {
    await fs.appendFile(
      path.join(message.params.cwd, "received-turns.jsonl"),
      JSON.stringify(message.params) + "\n",
    );
    await fs.writeFile(
      path.join(message.params.cwd, "received-agent-settings.json"),
      JSON.stringify({ thread: threadSettings, turn: message.params }),
    );
    turnId++;
    send({
      id: message.id,
      result: { turn: { id: `fixture-turn-${turnId}`, status: "inProgress" } },
    });
    await work(message.params);
  } else if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    send({
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: pending?.current || `fixture-turn-${turnId}`,
          status: "interrupted",
        },
      },
    });
    pending = undefined;
  }
});
