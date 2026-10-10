const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

// Fake only the model's Responses stream. The bundled app-server, Code Mode
// host, shell, patch tool, sandbox, and LaTeX compiler all run for real.
async function runCodeModeFixture({
  createCodexAgent,
  createResponseGateway,
  fetcher = fetch,
  root,
}) {
  const cwd = path.join(root, "manuscript");
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(
    path.join(cwd, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\n\\undefinedResearchCommand\n\\end{document}\n",
  );
  await fs.writeFile(path.join(cwd, "notes.txt"), "Before repair\n");
  const skillRoot = path.join(root, "skills");
  const skillPath = path.join(
    skillRoot,
    "workbench-fixture-writing",
    "SKILL.md",
  );
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(
    skillPath,
    "---\nname: workbench-fixture-writing\ndescription: Test native skill loading without paid inference.\n---\nWORKBENCH_NATIVE_SKILL_2026: Preserve factual claims during this isolated test.\n",
  );
  const requests = [],
    events = [];
  let serverError, agent, gateway;
  let credential = "unused-code-mode-fixture",
    refreshes = 0,
    rejectedBody;
  const compile =
    "latexmk -pdf -interaction=nonstopmode -halt-on-error -no-shell-escape -outdir=.research-build main.tex";
  const patch =
    "*** Begin Patch\n*** Update File: main.tex\n@@\n-\\undefinedResearchCommand\n+Compiled through Code Mode.\n*** Update File: notes.txt\n@@\n-Before repair\n+Fixed the undefined LaTeX command.\n*** End Patch";
  const commands = [compile, `apply_patch <<'PATCH'\n${patch}\nPATCH`, compile];
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.headers.authorization, `Bearer ${credential}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let data = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "gzip")
        data = zlib.gunzipSync(data);
      const body = JSON.parse(data.toString());
      // Renew after Code Mode has repaired the manuscript, before recompiling.
      if (requests.length === 2 && !rejectedBody) {
        assert.match(
          await fs.readFile(path.join(cwd, "main.tex"), "utf8"),
          /Compiled through Code Mode/,
        );
        rejectedBody = body;
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "token_expired" } }));
        return;
      }
      if (requests.length === 2) assert.deepEqual(body, rejectedBody);
      requests.push(body);
      if (requests.length === 1)
        assert.ok(
          JSON.stringify(body.input).includes("WORKBENCH_NATIVE_SKILL_2026"),
          "The native runtime must load the selected SKILL.md into model context",
        );
      assert.equal(body.model, "gpt-6-astra");
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      // This model carries Code Mode tool declarations in its input messages.
      assert.ok(
        JSON.stringify(body.input).includes("tools.exec_command"),
        "gpt-6-astra must receive the local shell tool declaration",
      );
      if (requests.length > 1) {
        const output = body.input.findLast(
          (item) => item.type === "custom_tool_call_output",
        );
        assert.ok(
          output,
          "The local host must return the exec result to the model",
        );
        assert.doesNotMatch(
          JSON.stringify(output.output),
          /code-mode host is disabled|Tool not found|Unknown tool/,
        );
      }
      assert.ok(
        requests.length <= 4,
        "The compile, repair, and compile sequence must finish without retries",
      );
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const emit = (type, details) =>
        response.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...details })}\n\n`,
        );
      const id = `resp_code_mode_${requests.length}`;
      emit("response.created", {
        response: { id, status: "in_progress", output: [] },
      });
      const cmd = commands[requests.length - 1];
      const item = cmd
        ? {
            id: `exec-item-${requests.length}`,
            type: "custom_tool_call",
            call_id: `exec-call-${requests.length}`,
            name: "exec",
            input: `const result = await tools.exec_command(${JSON.stringify({ cmd, workdir: cwd, login: false, yield_time_ms: 10000, max_output_tokens: 2000 })}); text(result);`,
          }
        : {
            id: "message-code-mode",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Fixed the LaTeX error, updated notes, and compiled the manuscript.",
                annotations: [],
              },
            ],
          };
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
          credential = "renewed-code-mode-fixture";
          refreshes++;
        }
        return credential;
      },
      fetcher: (url, options) =>
        fetcher(url.replace("https://api.openai.com/v1", local), options),
    });
    agent = createCodexAgent({
      accessToken: gateway.token,
      baseUrl: gateway.baseUrl,
      home: path.join(root, "agent-home"),
      skillRoots: [skillRoot],
      environment: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => !/^(https?|all|no)_proxy$/i.test(name),
          ),
        ),
        PATH: `/Library/TeX/texbin:${process.env.PATH || ""}`,
        NO_PROXY: "127.0.0.1,localhost",
      },
    });
    const catalog = await agent.listSkills(cwd, true);
    const skill = catalog.data
      .find((entry) => entry.cwd === cwd)
      .skills.find((item) => item.name === "workbench-fixture-writing");
    assert.equal(skill.path, await fs.realpath(skillPath));
    assert.equal(skill.enabled, true);
    const result = await agent.run({
      model: "gpt-6-astra",
      cwd,
      writableRoots: [cwd],
      text: "Compile main.tex, fix the undefined command, update notes.txt, and compile again. This is an isolated integration test.",
      skills: [skill],
      signal: AbortSignal.timeout(45000),
      onThread: async () => {},
      onEvent: (event) => events.push(event),
    });
    if (serverError) throw serverError;
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    assert.match(
      await fs.readFile(path.join(cwd, "main.tex"), "utf8"),
      /Compiled through Code Mode/,
    );
    assert.equal(
      await fs.readFile(path.join(cwd, "notes.txt"), "utf8"),
      "Fixed the undefined LaTeX command.\n",
    );
    const executions = events
      .filter(
        (event) =>
          event.method === "item/completed" &&
          event.params.item.type === "commandExecution",
      )
      .map((event) => event.params.item);
    // The runtime recognizes apply_patch and emits a fileChange item for it.
    assert.equal(executions.length, 2);
    assert.notEqual(executions[0].exitCode, 0);
    assert.match(executions[0].aggregatedOutput, /Undefined control sequence/);
    assert.equal(executions[1].exitCode, 0);
    assert.ok(
      events.some(
        (event) =>
          event.method === "item/completed" &&
          event.params.item.type === "fileChange",
      ),
    );
    const pdf = await fs.readFile(
      path.join(cwd, ".research-build", "main.pdf"),
    );
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(requests.length, 4);
    assert.equal(refreshes, 1);
    return {
      model: "gpt-6-astra",
      requests: requests.length,
      commands: executions.length,
      pdfBytes: pdf.length,
      nativeSkill: skill.name,
      refreshes,
    };
  } finally {
    await agent?.close();
    await gateway?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
module.exports = { runCodeModeFixture };
