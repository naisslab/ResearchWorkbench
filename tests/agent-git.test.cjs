const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const net = require("node:net");
const zlib = require("node:zlib");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createCodexAgent } = require("../electron/codex-agent.cjs");
const { createGitEnvironment } = require("../electron/git-runner.cjs");
const { withoutProxy } = require("./fixtures.cjs");
const execute = promisify(execFile);
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";

test(
  "native agent approves Git metadata writes and performs commit, push, fetch and pull over the network",
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "research-agent-git-"),
    );
    const cwd = path.join(root, "project");
    const remote = path.join(root, "remote.git");
    const updater = path.join(root, "updater");
    let agent, daemon, serverError;
    const events = [];
    let requests = 0;
    await fs.mkdir(cwd);
    await execute("/usr/bin/git", ["init", "--bare", remote]);
    const reservation = net.createServer();
    await new Promise((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const url = "git://127.0.0.1:" + port + "/remote.git";
    const command = [
      "set -eu",
      "printf '%s\\n' \"$https_proxy\"",
      "git init --initial-branch=main",
      "git config user.name Fixture",
      "git config user.email fixture@example.test",
      "printf 'Local change\\n' > manuscript.txt",
      "git add manuscript.txt",
      "git commit -m 'Local fixture change'",
      "git remote add origin " + quote(url),
      "git push --set-upstream origin main",
      "git clone --branch main " + quote(url) + " " + quote(updater),
      "git -C " + quote(updater) + " config user.name Fixture",
      "git -C " + quote(updater) + " config user.email fixture@example.test",
      "printf 'Remote change\\n' > " + quote(path.join(updater, "remote.txt")),
      "git -C " + quote(updater) + " add remote.txt",
      "git -C " + quote(updater) + " commit -m 'Remote fixture change'",
      "git -C " + quote(updater) + " push",
      "git fetch origin",
      "git pull --ff-only",
    ].join("\n");
    const server = http.createServer(async (request, response) => {
      try {
        assert.equal(request.url, "/v1/responses");
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        let data = Buffer.concat(chunks);
        if (request.headers["content-encoding"] === "gzip")
          data = zlib.gunzipSync(data);
        const body = JSON.parse(data.toString());
        assert.ok(
          ++requests <= 2,
          "Git must finish without replaying the command",
        );
        let item;
        if (requests === 1) {
          const tool = body.tools.find((t) => t.name === "exec_command");
          assert.ok(tool, "The native runtime must expose exec_command");
          item = {
            id: "git-fixture",
            type: "function_call",
            call_id: "git-fixture-call",
            name: tool.name,
            arguments: JSON.stringify({
              cmd: command,
              workdir: cwd,
              sandbox_permissions: "require_escalated",
              justification:
                "Run commit, push and pull only in this isolated test repository.",
              yield_time_ms: 10000,
              max_output_tokens: 2000,
            }),
          };
        } else {
          assert.equal(
            await fs.readFile(path.join(cwd, "remote.txt"), "utf8"),
            "Remote change\n",
          );
          item = {
            id: "git-reply",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Git fixture passed.",
                annotations: [],
              },
            ],
          };
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (type, details) =>
          response.write(
            "event: " +
              type +
              "\ndata: " +
              JSON.stringify({ type, ...details }) +
              "\n\n",
          );
        const id = "resp_git_fixture_" + requests;
        emit("response.created", {
          response: { id, status: "in_progress", output: [] },
        });
        emit("response.output_item.added", { output_index: 0, item });
        emit("response.output_item.done", { output_index: 0, item });
        emit("response.completed", {
          response: { id, status: "completed", output: [item] },
        });
        response.end();
      } catch (error) {
        serverError = error;
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    });
    try {
      daemon = spawn(
        "/usr/bin/git",
        [
          "daemon",
          "--verbose",
          "--reuseaddr",
          "--export-all",
          "--enable=receive-pack",
          "--listen=127.0.0.1",
          "--port=" + port,
          "--base-path=" + root,
          root,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Fixture Git server did not start")),
          3000,
        );
        daemon.once("error", reject);
        daemon.once("exit", () =>
          reject(new Error("Fixture Git server exited")),
        );
        daemon.stderr.on("data", (data) => {
          if (String(data).includes("Ready to rumble")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      agent = createCodexAgent({
        accessToken: "unused-local-fixture-token",
        baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
        home: path.join(root, "agent-home"),
        environment: await createGitEnvironment(
          {
            ...withoutProxy(process.env),
            PATH: "/usr/bin:/bin",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
          },
          async () => "PROXY 127.0.0.1:1",
        ),
      });
      const approvals = [];
      const result = await agent.run({
        model: "gpt-5.5",
        permissionMode: "default",
        cwd,
        writableRoots: [cwd],
        text: "Run the isolated Git fixture. Commit the local edit, push, and pull the remote edit.",
        signal: AbortSignal.timeout(20000),
        onThread: async () => {},
        onEvent: (event) => {
          events.push(event);
          if (event.type === "approval") {
            approvals.push(event.approval);
            assert.equal(event.approval.kind, "command");
            assert.ok(event.approval.command.includes(url));
            agent.answer(event.approval.id, "accept");
          }
        },
      });
      if (serverError) throw serverError;
      assert.equal(result.status, "completed", JSON.stringify(result.error));
      assert.equal(approvals.length, 1);
      const completed = events.filter(
        (e) =>
          e.method === "item/completed" &&
          e.params.item.type === "commandExecution",
      );
      assert.equal(completed.at(-1).params.item.exitCode, 0);
      assert.match(
        completed.at(-1).params.item.aggregatedOutput,
        /http:\/\/127\.0\.0\.1:1/,
      );
      assert.equal(
        await fs.readFile(path.join(cwd, "manuscript.txt"), "utf8"),
        "Local change\n",
      );
      const git = async (folder, args) =>
        (await execute("/usr/bin/git", ["-C", folder, ...args])).stdout.trim();
      assert.equal(
        await git(cwd, ["rev-parse", "HEAD"]),
        await git(remote, ["rev-parse", "refs/heads/main"]),
      );
      assert.equal(await git(cwd, ["status", "--porcelain"]), "");
      assert.equal(await git(cwd, ["rev-list", "--count", "HEAD"]), "2");
    } finally {
      await agent?.close();
      if (daemon && daemon.exitCode === null) {
        const stopped = new Promise((resolve) => daemon.once("exit", resolve));
        daemon.kill();
        await stopped;
      }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
