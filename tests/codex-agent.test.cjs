const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createCodexAgent } = require("../electron/codex-agent.cjs");
const { createResponseGateway } = require("../electron/response-gateway.cjs");

test(
  "the bundled native app-server survives mid-turn disconnection and token expiry without replaying file edits or commands",
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "research-native-agent-"),
    );
    const cwd = path.join(root, "project");
    await fs.mkdir(cwd);
    const requests = [],
      events = [];
    let serverError, agent, gateway, savedThreadId;
    let accepted = 0,
      disconnections = 0,
      refreshes = 0,
      credential = "unused-native-fixture-token";
    const server = http.createServer(async (request, response) => {
      try {
        assert.equal(request.url, "/v1/responses");
        assert.equal(
          request.headers.authorization,
          `Bearer ${requests.length < 2 ? "unused-native-fixture-token" : "renewed-native-fixture-token"}`,
        );
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        let data = Buffer.concat(chunks);
        if (request.headers["content-encoding"] === "gzip")
          data = zlib.gunzipSync(data);
        const body = JSON.parse(data.toString());
        requests.push(body);
        assert.equal(body.store, false);
        assert.equal(body.stream, true);
        if (requests.length === 2) {
          // Expiry occurs after a real tool has already changed the filesystem.
          assert.equal(
            await fs.readFile(path.join(cwd, "one.txt"), "utf8"),
            "First file\n",
          );
          response.writeHead(401, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              error: {
                code: "token_expired",
                message: "Provided authentication token is expired.",
              },
            }),
          );
          return;
        }
        if (requests.length === 3) assert.deepEqual(body, requests[1]);
        accepted++;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const emit = (type, details) =>
          response.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...details })}\n\n`,
          );
        const id = `resp_fixture_${requests.length}`;
        emit("response.created", {
          response: { id, status: "in_progress", output: [] },
        });
        let item;
        if (accepted === 1) {
          const tool = body.tools.find((t) => t.name === "apply_patch");
          const patch =
            "*** Begin Patch\n*** Add File: one.txt\n+First file\n*** Add File: two.txt\n+Second file\n*** End Patch";
          if (!tool) {
            assert.ok(body.tools.some((t) => t.name === "exec_command"));
            item = {
              id: "patch-fixture",
              type: "function_call",
              call_id: "patch-call",
              name: "exec_command",
              arguments: JSON.stringify({
                cmd: `apply_patch <<'PATCH'\n${patch}\nPATCH`,
                workdir: cwd,
                yield_time_ms: 1000,
                max_output_tokens: 1000,
              }),
            };
          } else
            item =
              tool.type === "custom"
                ? {
                    id: "patch-fixture",
                    type: "custom_tool_call",
                    call_id: "patch-call",
                    name: tool.name,
                    input: patch,
                  }
                : {
                    id: "patch-fixture",
                    type: "function_call",
                    call_id: "patch-call",
                    name: tool.name,
                    arguments: JSON.stringify({ patch }),
                  };
        } else if (accepted === 2) {
          const tool = body.tools.find((t) =>
            ["exec_command", "shell_command", "shell"].includes(t.name),
          );
          assert.ok(tool, "Native agent must expose a local shell tool");
          const command = `${JSON.stringify(process.execPath)} -e "const f=require('fs');f.appendFileSync('executions.txt','once\\n');if(!f.readFileSync('one.txt','utf8').includes('First')||!f.readFileSync('two.txt','utf8').includes('Second'))process.exit(1);console.log('native checks passed')"`;
          const args =
            tool.name === "shell"
              ? { command: ["/bin/zsh", "-c", command], workdir: cwd }
              : tool.name === "shell_command"
                ? { command, workdir: cwd }
                : {
                    cmd: command,
                    workdir: cwd,
                    yield_time_ms: 1000,
                    max_output_tokens: 1000,
                  };
          item = {
            id: "command-fixture",
            type: "function_call",
            call_id: "command-call",
            name: tool.name,
            arguments: JSON.stringify(args),
          };
        } else {
          assert.ok(
            accepted <= 4,
            "Fixture tools should finish without retries",
          );
          item = {
            id: "message-fixture",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Two files updated and checks passed.",
                annotations: [],
              },
            ],
          };
        }
        emit("response.output_item.added", { output_index: 0, item });
        if (item.type === "message")
          emit("response.output_text.delta", {
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: item.content[0].text,
          });
        emit("response.output_item.done", { output_index: 0, item });
        emit("response.completed", {
          response: {
            id,
            status: "completed",
            output: [item],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        });
        response.end();
      } catch (error) {
        serverError = error;
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const local = `http://127.0.0.1:${server.address().port}/v1`;
      gateway = await createResponseGateway({
        accessToken: async ({ rejectedToken } = {}) => {
          if (rejectedToken) {
            assert.equal(rejectedToken, credential);
            credential = "renewed-native-fixture-token";
            refreshes++;
          }
          return credential;
        },
        fetcher: async (url, options) => {
          if (requests.length === 1 && !disconnections) {
            disconnections++;
            assert.equal(
              await fs.readFile(path.join(cwd, "one.txt"), "utf8"),
              "First file\n",
            );
            throw new Error("net::ERR_CONNECTION_RESET");
          }
          return fetch(
            url.replace("https://api.openai.com/v1", local),
            options,
          );
        },
      });
      agent = createCodexAgent({
        accessToken: gateway.token,
        baseUrl: gateway.baseUrl,
        home: path.join(root, "agent-home"),
        environment: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) => !/^(https?|all|no)_proxy$/i.test(name),
            ),
          ),
          NO_PROXY: "127.0.0.1,localhost",
        },
      });
      const result = await agent.run({
        model: "gpt-5.5",
        reasoningEffort: "high",
        serviceTier: "priority",
        cwd,
        writableRoots: [cwd],
        text: "Create one.txt and two.txt with apply_patch and run the local check. This is an isolated integration test.",
        signal: AbortSignal.timeout(25000),
        onThread: async (id) => {
          savedThreadId = id;
        },
        onEvent: (event) => events.push(event),
      });
      if (serverError) throw serverError;
      assert.equal(
        result.status,
        "completed",
        JSON.stringify({
          error: result.error,
          requests: requests.length,
          events: events.map((e) => e.method),
        }),
      );
      assert.equal(
        await fs.readFile(path.join(cwd, "one.txt"), "utf8"),
        "First file\n",
      );
      assert.equal(
        await fs.readFile(path.join(cwd, "two.txt"), "utf8"),
        "Second file\n",
      );
      const commands = events.filter(
        (e) =>
          e.method === "item/completed" &&
          e.params.item.type === "commandExecution",
      );
      assert.equal(commands.at(-1)?.params.item.exitCode, 0);
      assert.match(
        commands.at(-1)?.params.item.aggregatedOutput,
        /native checks passed/,
      );
      assert.ok(
        events.some(
          (e) =>
            e.method === "item/completed" &&
            e.params.item.type === "fileChange",
        ),
      );
      assert.equal(requests.length, 4);
      assert.equal(refreshes, 1);
      assert.equal(disconnections, 1);
      assert.equal(
        await fs.readFile(path.join(cwd, "executions.txt"), "utf8"),
        "once\n",
      );
      assert.equal(
        events.filter((event) => event.method === "turn/started").length,
        1,
      );
      for (const request of requests) {
        assert.equal(request.reasoning.effort, "high");
        assert.equal(request.service_tier, "priority");
      }
      const standard = await agent.run({
        savedThreadId,
        model: "gpt-5.5",
        permissionMode: "read-only",
        reasoningEffort: "low",
        serviceTier: "default",
        cwd,
        writableRoots: [cwd],
        text: "Summarize the completed work without changing files.",
        signal: AbortSignal.timeout(10000),
        onThread: async () => {},
        onEvent: () => {},
      });
      if (serverError) throw serverError;
      assert.equal(standard.status, "completed");
      assert.equal(requests.at(-1).reasoning.effort, "low");
      assert.ok(
        !requests.at(-1).service_tier ||
          requests.at(-1).service_tier === "default",
        "Standard speed must clear the previous priority tier",
      );
    } finally {
      await agent?.close();
      await gateway?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "native app-server exposes the writing tool and returns its application receipt",
  { timeout: 30000 },
  async (t) => {
    const { writingTool } = require("../electron/writing.cjs");
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "research-writing-tool-"),
    );
    let agent,
      requests = 0,
      serverError;
    const calls = [];
    const server = http.createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let bytes = Buffer.concat(chunks);
        if (req.headers["content-encoding"] === "gzip")
          bytes = zlib.gunzipSync(bytes);
        const body = JSON.parse(bytes.toString());
        requests++;
        assert.ok(
          body.tools.some((tool) => tool.name === "record_writing_items"),
        );
        if (requests > 1)
          assert.match(JSON.stringify(body.input), /"saved"|\\"saved\\"/);
        const item =
          requests === 1
            ? {
                id: "writing_call",
                type: "function_call",
                call_id: "writing_call",
                name: "record_writing_items",
                arguments: JSON.stringify({
                  tasks: ["修改摘要"],
                  note: "保持技术结论",
                }),
              }
            : {
                id: "writing_reply",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "Saved in project details.",
                    annotations: [],
                  },
                ],
              };
        res.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (type, value) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`,
          );
        const id = `writing_response_${requests}`;
        emit("response.created", {
          response: { id, status: "in_progress", output: [] },
        });
        emit("response.output_item.added", { output_index: 0, item });
        emit("response.output_item.done", { output_index: 0, item });
        emit("response.completed", {
          response: { id, status: "completed", output: [item] },
        });
        res.end();
      } catch (error) {
        serverError = error;
        res.writeHead(500);
        res.end();
      }
    });
    t.after(async () => {
      await agent?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    agent = createCodexAgent({
      accessToken: "unused-fixture-token",
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      home: path.join(root, "home"),
    });
    const result = await agent.run({
      model: "gpt-5.5",
      cwd: root,
      writableRoots: [root],
      text: "Record a writing to-do and note.",
      dynamicTools: [writingTool],
      signal: AbortSignal.timeout(20000),
      onThread: async () => {},
      onEvent: () => {},
      onTool: async (name, args) => {
        calls.push({ name, args });
        return { saved: true };
      },
    });
    if (serverError) throw serverError;
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.deepEqual(calls, [
      {
        name: "record_writing_items",
        args: { tasks: ["修改摘要"], note: "保持技术结论" },
      },
    ]);
    assert.equal(requests, 2);
  },
);
