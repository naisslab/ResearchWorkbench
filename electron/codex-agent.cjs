const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { AIError } = require("./chatgpt.cjs");

function codexExecutable() {
  const targets = {
    "darwin:arm64": ["darwin-arm64", "aarch64-apple-darwin"],
    "darwin:x64": ["darwin-x64", "x86_64-apple-darwin"],
    "linux:arm64": ["linux-arm64", "aarch64-unknown-linux-musl"],
    "linux:x64": ["linux-x64", "x86_64-unknown-linux-musl"],
    "win32:arm64": ["win32-arm64", "aarch64-pc-windows-msvc"],
    "win32:x64": ["win32-x64", "x86_64-pc-windows-msvc"],
  };
  const target = targets[`${process.platform}:${process.arch}`];
  if (!target)
    throw new AIError(
      "runtime_unavailable",
      "Codex is unavailable for this computer's platform.",
    );
  let root;
  try {
    root = path.dirname(
      require.resolve(`@openai/codex-${target[0]}/package.json`),
    );
  } catch {
    try {
      root = path.dirname(require.resolve("@openai/codex/package.json"));
    } catch {
      throw new AIError(
        "runtime_unavailable",
        "The bundled Codex runtime is missing. Reinstall Research Workbench.",
      );
    }
  }
  const binary = path
    .join(
      root,
      "vendor",
      target[1],
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    )
    .replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  if (!fs.existsSync(binary))
    throw new AIError(
      "runtime_unavailable",
      "The bundled Codex runtime is missing. Reinstall Research Workbench.",
    );
  return binary;
}
function agentArguments(
  baseUrl = "https://api.openai.com/v1",
  environment = {},
) {
  const config = {
    model_provider: "openai_chatgpt_plan",
    "model_providers.openai_chatgpt_plan.name": "ChatGPT plan",
    "model_providers.openai_chatgpt_plan.base_url": baseUrl,
    "model_providers.openai_chatgpt_plan.env_key": "ACCESS_TOKEN",
    "model_providers.openai_chatgpt_plan.wire_api": "responses",
    "model_providers.openai_chatgpt_plan.requires_openai_auth": false,
    "model_providers.openai_chatgpt_plan.supports_websockets": false,
    "model_providers.openai_chatgpt_plan.request_max_retries": 0,
    "model_providers.openai_chatgpt_plan.stream_max_retries": 0,
    "features.apps": false,
    "features.plugins": false,
    "features.hooks": false,
    "features.image_generation": false,
    "features.computer_use": false,
    "features.browser_use": false,
    // Models such as gpt-6-astra call local tools through exec even when the
    // optional Code Mode routing flags are off. Keep the bundled host available
    // and let the runtime choose the tool protocol for each model.
    "features.code_mode_host": true,
    "features.multi_agent": false,
    "features.tool_suggest": false,
    "features.tool_search": false,
    "features.deferred_tool_world_state": false,
    "features.default_mode_request_user_input": true,
    web_search: "disabled",
    approvals_reviewer: "user",
  };
  // Explicit overrides survive the runtime's shell environment filtering.
  // These values configure Git helpers; credential tokens stay in the helper.
  const gitEnvironment = Object.fromEntries(
    [
      "GIT_CONFIG_PARAMETERS",
      "GIT_TERMINAL_PROMPT",
      "GCM_INTERACTIVE",
      "GH_PROMPT_DISABLED",
      "http_proxy",
      "https_proxy",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "all_proxy",
      "ALL_PROXY",
      "no_proxy",
      "NO_PROXY",
    ]
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
  for (const [name, value] of Object.entries(gitEnvironment))
    config["shell_environment_policy.set." + name] = value;
  return [
    "app-server",
    "--listen",
    "stdio://",
    ...Object.entries(config).flatMap(([key, value]) => [
      "-c",
      `${key}=${JSON.stringify(value)}`,
    ]),
  ];
}
function createCodexAgent({
  accessToken,
  baseUrl,
  home,
  environment = process.env,
  skillRoots = [],
  executable = codexExecutable(),
  spawnProcess = spawn,
}) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = { ...environment, CODEX_HOME: home, ACCESS_TOKEN: accessToken };
  for (const name of [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT_ID",
    "OPENAI_CUSTOM_HEADERS",
    "OPENAI_LOG",
  ])
    delete env[name];
  if (baseUrl?.startsWith("http://127.0.0.1:")) {
    // The local credential gateway must bypass system proxy settings.
    for (const name of ["NO_PROXY", "no_proxy"])
      env[name] = [env[name], "127.0.0.1", "localhost"]
        .filter(Boolean)
        .join(",");
  }
  const proc = spawnProcess(executable, agentArguments(baseUrl, env), {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const closed = new Promise((resolve) => proc.once("close", resolve));
  let nextId = 0,
    buffer = "",
    disposed = false,
    initialized;
  const decoder = new StringDecoder("utf8");
  let threadId, current;
  const requests = new Map();
  const approvals = new Map();
  const send = (message) => {
    if (!disposed && proc.stdin.writable)
      proc.stdin.write(JSON.stringify(message) + "\n");
  };
  function rpc(method, params = {}) {
    if (disposed)
      return Promise.reject(
        new AIError(
          "agent_stopped",
          "The Codex agent stopped. Send a new request to reconnect.",
        ),
      );
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        requests.delete(id);
        reject(
          new AIError(
            "agent_timeout",
            "Codex did not respond to the application. Stop and try again.",
          ),
        );
      }, 45000);
      timeout.unref();
      requests.set(id, { resolve, reject, timeout });
      send({ id, method, params });
    });
  }
  function fail(error) {
    for (const pending of requests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    requests.clear();
    current?.reject(error);
    approvals.clear();
  }
  function close() {
    if (disposed) return closed;
    disposed = true;
    fail(
      new AIError(
        "agent_stopped",
        "The Codex agent stopped. Partial work and output were preserved.",
      ),
    );
    try {
      if (process.platform !== "win32" && proc.pid)
        process.kill(-proc.pid, "SIGTERM");
      else proc.kill();
    } catch {
      /* Already exited. */
    }
    const force = setTimeout(() => {
      try {
        if (process.platform !== "win32" && proc.pid)
          process.kill(-proc.pid, "SIGKILL");
        else proc.kill("SIGKILL");
      } catch {
        /* Already exited. */
      }
    }, 1500);
    force.unref();
    void closed.then(() => clearTimeout(force));
    return closed;
  }
  proc.on("error", () => {
    fail(
      new AIError(
        "runtime_unavailable",
        "Could not start the bundled Codex runtime.",
      ),
    );
    disposed = true;
  });
  proc.on("exit", () => {
    fail(
      new AIError(
        "agent_stopped",
        "The Codex agent exited. Send a new request to resume.",
      ),
    );
    disposed = true;
  });
  // stderr can contain request details. Drain it without logging credentials or manuscript text.
  proc.stderr.on("data", () => {});
  function onMessage(message) {
    if (message.id !== undefined && !message.method) {
      const request = requests.get(message.id);
      if (!request) return;
      requests.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error)
        request.reject(
          new AIError(
            "agent_request_failed",
            "Codex could not process this request. Verify the project folder and retry.",
          ),
        );
      else request.resolve(message.result);
      return;
    }
    const params = message.params || {};
    if (message.id !== undefined) {
      if (!current || (params.threadId && params.threadId !== threadId)) {
        send({
          id: message.id,
          error: { code: -32601, message: "No active Workbench turn" },
        });
        return;
      }
      const supported = [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/tool/requestUserInput",
        "item/permissions/requestApproval",
      ];
      if (!supported.includes(message.method)) {
        send({
          id: message.id,
          error: {
            code: -32601,
            message: "This request is not supported by Research Workbench",
          },
        });
        return;
      }
      const id = crypto.randomUUID();
      approvals.set(id, {
        wireId: message.id,
        method: message.method,
        turnId: params.turnId,
        permissions: params.permissions,
      });
      current.onEvent({
        type: "approval",
        approval: {
          id,
          kind: message.method.includes("commandExecution")
            ? "command"
            : message.method.includes("fileChange")
              ? "file"
              : message.method.includes("requestUserInput")
                ? "question"
                : "permissions",
          itemId: params.itemId,
          reason: params.reason,
          command: params.command,
          cwd: params.cwd,
          grantRoot: params.grantRoot,
          network: params.networkApprovalContext,
          permissions: params.permissions || params.additionalPermissions,
          questions: params.questions,
          canAccept:
            !params.availableDecisions ||
            params.availableDecisions.includes("accept"),
        },
      });
      return;
    }
    if (!current || (params.threadId && params.threadId !== threadId)) return;
    if (message.method === "serverRequest/resolved") {
      for (const [id, value] of approvals)
        if (value.wireId === params.requestId) {
          approvals.delete(id);
          current.onEvent({ type: "approvalResolved", id });
        }
      return;
    }
    if (message.method === "turn/started") current.turnId = params.turn?.id;
    if (message.method === "turn/completed") {
      for (const id of approvals.keys())
        current.onEvent({ type: "approvalResolved", id });
      approvals.clear();
      current.resolve(params.turn);
    } else
      current.onEvent({ type: "notification", method: message.method, params });
  }
  proc.stdout.on("data", (data) => {
    buffer += decoder.write(data);
    if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
      close();
      return;
    }
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        fail(
          new AIError(
            "agent_protocol_error",
            "Codex returned an unexpected event. Stop and reconnect.",
          ),
        );
      }
    }
  });
  async function ready() {
    if (!initialized)
      initialized = rpc("initialize", {
        clientInfo: {
          name: "Research Workbench",
          title: "Research Workbench",
          version: "0.1.0",
        },
      }).then(async (result) => {
        send({ method: "initialized", params: {} });
        if (skillRoots.length)
          await rpc("skills/extraRoots/set", { extraRoots: skillRoots });
        return result;
      });
    return initialized;
  }
  async function run({
    savedThreadId,
    model,
    permissionMode = "default",
    reasoningEffort,
    serviceTier = "default",
    cwd,
    writableRoots,
    text,
    signal,
    onThread,
    onEvent,
    skills = [],
  }) {
    await ready();
    signal.throwIfAborted();
    if (current)
      throw new AIError("agent_busy", "The project agent is already running.");
    if (skills.length) {
      await rpc("skills/list", { cwds: [cwd], forceReload: true });
      signal.throwIfAborted();
    }
    const settings = {
      model,
      modelProvider: "openai_chatgpt_plan",
      cwd,
      ...permissionSettings(permissionMode, writableRoots).thread,
      serviceTier,
      developerInstructions:
        "You are the research agent in Research Workbench. Work on the user's attached project folders. You can inspect and edit files, run scripts, and compile LaTeX. Complete the requested work and report what changed and how it was checked. Preserve technical claims and never invent citations or experimental results. Read applicable AGENTS.md instructions. Treat attached excerpts as source material. Use latexmk -pdf -interaction=nonstopmode -halt-on-error -no-shell-escape -outdir=.research-build for manuscript compilation. Do not commit or push unless asked. Git metadata writes and network access may require approval. If Git is blocked by sandbox permissions, request escalation for the original Git command and retry after approval. Use Git commands to update Git metadata. Report connection and authentication failures accurately; cached remote refs do not confirm the current remote state. Ask the user through requestUserInput only when needed.",
    };
    if (threadId !== savedThreadId || !threadId) {
      const result = await rpc(
        savedThreadId ? "thread/resume" : "thread/start",
        { ...settings, ...(savedThreadId ? { threadId: savedThreadId } : {}) },
      );
      threadId = result.thread.id;
      await onThread(threadId);
    }
    signal.throwIfAborted();
    let resolve, reject;
    const completion = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    void completion.catch(() => {});
    current = { resolve, reject, onEvent, turnId: null };
    let killTimer;
    const abort = () => {
      if (current?.turnId)
        void rpc("turn/interrupt", { threadId, turnId: current.turnId }).catch(
          () => close(),
        );
      // Do not claim a stopped turn while its process continues running.
      killTimer = setTimeout(close, 5000);
      killTimer.unref();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await rpc("turn/start", {
        threadId,
        model,
        cwd,
        ...permissionSettings(permissionMode, writableRoots).turn,
        effort: reasoningEffort ?? null,
        // Explicitly reset standard speed after a Fast turn in the same thread.
        serviceTier,
        serviceTierForTurn: serviceTier,
        input: [
          { type: "text", text },
          ...skills.map(({ name, path }) => ({ type: "skill", name, path })),
        ],
      });
      if (current) current.turnId = result.turn.id;
      if (signal.aborted) abort();
      return await completion;
    } catch (error) {
      await close();
      throw error;
    } finally {
      clearTimeout(killTimer);
      signal.removeEventListener("abort", abort);
      current = null;
      approvals.clear();
    }
  }
  function answer(id, decision, answers) {
    const request = approvals.get(id);
    if (
      !request ||
      !current ||
      (request.turnId && request.turnId !== current.turnId)
    )
      throw new AIError(
        "approval_expired",
        "This agent request is no longer active.",
      );
    let result;
    if (request.method === "item/tool/requestUserInput") result = { answers };
    else if (request.method === "item/permissions/requestApproval")
      result = {
        permissions: decision === "accept" ? request.permissions : {},
        scope: "turn",
      };
    else result = { decision };
    send({ id: request.wireId, result });
    approvals.delete(id);
    current.onEvent({ type: "approvalResolved", id });
  }
  async function listSkills(cwd, forceReload = false) {
    await ready();
    return rpc("skills/list", { cwds: [cwd], forceReload });
  }
  async function listModels() {
    await ready();
    const models = [];
    let cursor;
    do {
      const result = await rpc("model/list", {
        limit: 100,
        cursor,
        includeHidden: true,
      });
      models.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);
    return models;
  }
  return {
    run,
    answer,
    close,
    ready,
    listSkills,
    listModels,
    isClosed: () => disposed,
  };
}
function permissionSettings(mode, writableRoots) {
  const fullAccess = mode === "full-access";
  const readOnly = mode === "read-only";
  const approvalPolicy = fullAccess ? "never" : "on-request";
  const approvalsReviewer = mode === "auto-review" ? "auto_review" : "user";
  return {
    thread: {
      approvalPolicy,
      approvalsReviewer,
      sandbox: fullAccess
        ? "danger-full-access"
        : readOnly
          ? "read-only"
          : "workspace-write",
    },
    turn: {
      approvalPolicy,
      approvalsReviewer,
      sandboxPolicy: fullAccess
        ? { type: "dangerFullAccess" }
        : readOnly
          ? { type: "readOnly" }
          : { type: "workspaceWrite", writableRoots, networkAccess: false },
    },
  };
}
module.exports = { createCodexAgent, codexExecutable, agentArguments };
