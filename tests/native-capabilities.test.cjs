const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const { createCodexAgent } = require("../electron/codex-agent.cjs");
const { waitFor } = require("./ai-fixtures.cjs");
const {
  serverConfig,
  validateElicitation,
} = require("../electron/native-agent-settings.cjs");

test(
  "native Codex steers a live turn, forks history, reviews changes, searches the web, and calls an approved MCP tool",
  { timeout: 90000 },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "native-capabilities-"),
    );
    const cwd = path.join(root, "project");
    await fs.mkdir(cwd);
    execFileSync("git", ["init", "-q", cwd]);
    await fs.writeFile(path.join(cwd, "README.md"), "Fixture\n");
    execFileSync("git", ["-C", cwd, "add", "."]);
    execFileSync("git", [
      "-C",
      cwd,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "Fixture",
    ]);
    const bodies = [],
      events = [];
    let phase = "steer",
      held,
      error,
      agent,
      threadId;
    const finish = (response, item) => {
      const emit = (type, details) =>
        response.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...details })}\n\n`,
        );
      response.writeHead(200, { "content-type": "text/event-stream" });
      emit("response.created", {
        response: {
          id: `response-${bodies.length}`,
          status: "in_progress",
          output: [],
        },
      });
      emit("response.output_item.added", { output_index: 0, item });
      emit("response.output_item.done", { output_index: 0, item });
      emit("response.completed", {
        response: {
          id: `response-${bodies.length}`,
          status: "completed",
          output: [item],
        },
      });
      response.end();
    };
    const reply = (text) => ({
      id: `reply-${bodies.length}`,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
      phase: "final_answer",
    });
    const server = http.createServer(async (request, response) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const body = JSON.parse(
          (request.headers["content-encoding"] === "gzip"
            ? zlib.gunzipSync(bytes)
            : bytes
          ).toString(),
        );
        bodies.push({ phase, body });
        assert.ok(
          bodies.length < 12,
          "Native fixture must terminate instead of repeating a failed tool call",
        );
        if (phase === "steer" && !held) {
          held = response;
          return;
        }
        if (
          phase === "mcp" &&
          !body.input.some(
            (item) =>
              item.type === "function_call_output" &&
              JSON.stringify(item.output).includes("approved-label"),
          )
        ) {
          const namespace = body.tools.find(
            (tool) =>
              tool.type === "namespace" && tool.name.includes("fixture"),
          );
          const tool = namespace?.tools.find((tool) => tool.name === "echo");
          assert.ok(tool, "Native MCP tool is exposed as a supported function");
          assert.ok(
            !body.tools.some((tool) => tool.type === "tool_search"),
            "Unsupported Responses tool_search is absent",
          );
          finish(response, {
            id: "mcp-call",
            type: "function_call",
            call_id: "mcp-fixture-call",
            namespace: namespace.name,
            name: tool.name,
            arguments: "{}",
          });
        } else
          finish(
            response,
            reply(
              phase === "review"
                ? JSON.stringify({
                    findings: [],
                    overall_correctness: "patch is correct",
                    overall_explanation: "Fixture review completed",
                    overall_confidence_score: 0.9,
                  })
                : `Completed ${phase}`,
            ),
          );
      } catch (e) {
        error = e;
        response.writeHead(500);
        response.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const makeAgent = () =>
      createCodexAgent({
        accessToken: "unused-fixture-token",
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        home: path.join(root, "home"),
        environment: { PATH: process.env.PATH, HOME: root },
      });
    agent = makeAgent();
    const reload = async () => {
      await agent.close();
      agent = makeAgent();
    };
    t.after(async () => {
      held?.end();
      await agent.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    });
    const run = (text, extra = {}) =>
      agent.run({
        savedThreadId: threadId,
        model: "gpt-5.5",
        cwd,
        writableRoots: [cwd],
        permissionMode: "read-only",
        text,
        signal: new AbortController().signal,
        onThread: (id) => {
          threadId = id;
        },
        onEvent: (event) => {
          events.push(event);
          if (event.type === "approval" && event.approval.kind === "mcp")
            agent.answer(event.approval.id, "accept", undefined, {
              label: "approved-label",
            });
        },
        ...extra,
      });
    assert.equal((await agent.nativeSettings(cwd)).webSearch, "cached");
    const first = run("Original request: keep the ICLR template");
    await waitFor(
      () => held && events.some((event) => event.method === "turn/started"),
    );
    const turnId = events.find((event) => event.method === "turn/started")
      .params.turn.id;
    await assert.rejects(
      agent.steer({ expectedTurnId: "stale-turn", text: "Should not appear" }),
      { code: "turn_expired" },
    );
    await agent.steer({
      expectedTurnId: turnId,
      text: "Only remove the conference name",
    });
    finish(held, reply("First step complete"));
    assert.equal((await first).status, "completed");
    assert.ok(
      bodies.some(({ body }) =>
        JSON.stringify(body.input).includes("Only remove the conference name"),
      ),
    );
    const cachedSearch = bodies[0].body.tools.find((tool) =>
      tool.type.includes("web_search"),
    );
    assert.ok(cachedSearch, "Default cached web search is available");
    assert.equal(cachedSearch.external_web_access, false);
    await assert.rejects(
      agent.steer({ expectedTurnId: turnId, text: "Too late" }),
      { code: "turn_expired" },
    );

    const original = threadId;
    threadId = await agent.fork(original, cwd);
    assert.notEqual(threadId, original);
    phase = "fork";
    await agent.configure("web_search", "live");
    await reload();
    assert.equal((await agent.nativeSettings(cwd)).webSearch, "live");
    assert.equal(
      (await run("Explore the alternate approach")).status,
      "completed",
    );
    const fork = bodies.find((item) => item.phase === "fork").body;
    assert.match(
      JSON.stringify(fork.input),
      /Original request: keep the ICLR template/,
    );
    assert.match(JSON.stringify(fork.input), /Only remove the conference name/);
    assert.equal(
      fork.tools.find((tool) => tool.type.includes("web_search"))
        .external_web_access,
      true,
    );

    await agent.configure("web_search", "disabled");
    await reload();
    await fs.writeFile(path.join(cwd, "README.md"), "Updated fixture\n");
    phase = "review";
    assert.equal(
      (await run("", { reviewTarget: { type: "uncommittedChanges" } })).status,
      "completed",
    );
    assert.ok(
      events.some((event) => event.params?.item?.type === "exitedReviewMode"),
      "Native review lifecycle is reported",
    );
    assert.ok(
      bodies
        .filter((item) => item.phase === "review")
        .every(
          ({ body }) =>
            !body.tools.some((tool) => tool.type.includes("web_search")),
        ),
    );

    phase = "mcp";
    await agent.configure("mcp_servers.fixture", {
      command: process.execPath,
      args: [path.join(__dirname, "fixtures/native-mcp.cjs")],
    });
    await reload();
    const settings = await agent.nativeSettings(cwd);
    assert.equal(
      settings.servers.find((server) => server.name === "fixture")?.toolCount,
      1,
    );
    const mcpTurn = await run("Use the fixture MCP echo tool");
    if (error) throw error;
    assert.equal(mcpTurn.status, "completed", JSON.stringify(mcpTurn.error));
    if (error) throw error;
    assert.ok(
      events.some(
        (event) =>
          event.type === "approval" && event.approval.serverName === "fixture",
      ),
    );
    assert.ok(
      bodies.some(({ body }) =>
        JSON.stringify(body.input).includes("approved-label"),
      ),
    );
    await agent.configure("mcp_servers.fixture.enabled", false);
    assert.equal(
      (await agent.nativeSettings(cwd)).servers.find(
        (server) => server.name === "fixture",
      ).enabled,
      false,
    );
  },
);

test("MCP configuration and elicitation reject malformed inputs without accepting the request", () => {
  assert.throws(() => serverConfig({ name: "x.enabled", command: "node" }), {
    code: "invalid_server",
  });
  assert.throws(() => serverConfig({ name: "x", url: "file:///tmp/x" }), {
    code: "invalid_server",
  });
  assert.throws(
    () => serverConfig({ name: "x", command: "node", args: "--help" }),
    { code: "invalid_server" },
  );
  const schema = {
    type: "object",
    properties: {
      consent: { type: "boolean" },
      count: { type: "integer", minimum: 1 },
      labels: { type: "array", items: { enum: ["one", "two"] }, minItems: 1 },
    },
    required: ["consent", "count"],
  };
  validateElicitation(schema, { consent: false, count: 2, labels: ["one"] });
  for (const content of [
    { consent: "yes", count: 1 },
    { consent: true },
    { consent: true, count: 0 },
    { consent: true, count: 1, labels: ["unknown"] },
    { consent: true, count: 1, unexpected: true },
  ])
    assert.throws(() => validateElicitation(schema, content), {
      code: "invalid_answer",
    });
});
