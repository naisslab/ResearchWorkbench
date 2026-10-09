import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-ai-ui-"));
const folder = path.join(root, "manuscript");
await fs.mkdir(folder);
await fs.writeFile(path.join(folder, "main.tex"), "Original manuscript\n");
await fs.mkdir("output/playwright", { recursive: true });
let desktop, page;
const failures = [];
try {
  desktop = await electron.launch({
    executablePath: process.env.RESEARCH_APP_PATH || undefined,
    args: process.env.RESEARCH_APP_PATH ? [] : ["."],
    cwd: process.cwd(),
    env: { ...process.env, RESEARCH_TEST_DATA: root, RESEARCH_DEV_URL: "" },
  });
  page = await desktop.firstWindow();
  page.on("pageerror", (e) => failures.push(e.message));
  await page
    .getByRole("heading", { name: "Research Overview", exact: true })
    .waitFor();
  await page.evaluate(async (folder) => {
    const state = await window.research.load();
    const project = {
      ...state.projects[0],
      id: "ai-ui-project",
      name: "Agent Integration",
      folder,
      mainFile: "main.tex",
      localFolders: [],
      tasks: [],
      notes: "",
      deadlines: [],
      links: [],
    };
    await window.research.save({
      ...state,
      projects: [project],
      appearance: "light",
    });
  }, folder);
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Agent Integration", exact: true })
    .click();
  await page.locator(".cm-content").waitFor();
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "AI", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue with ChatGPT", exact: false })
    .waitFor();
  const runtime = await page.evaluate(
    async () => (await window.research.aiState()).value.runtime,
  );
  assert.equal(
    runtime.available,
    true,
    "Packaged Codex executable must be discoverable",
  );
  const initialized = await desktop.evaluate(async ({ app }, root) => {
    const requireApp = process
      .getBuiltinModule("node:module")
      .createRequire(`${app.getAppPath()}/package.json`);
    const { createCodexAgent } = requireApp("./electron/codex-agent.cjs");
    const agent = createCodexAgent({
      accessToken: "unused-initialize-fixture",
      home: `${root}/runtime-check`,
    });
    try {
      return await agent.ready();
    } finally {
      await agent.close();
    }
  }, root);
  assert.match(initialized.userAgent, /Research Workbench/);
  const codeMode = await desktop.evaluate(
    async ({ app }, { root, fixture }) => {
      const requireApp = process
        .getBuiltinModule("node:module")
        .createRequire(`${app.getAppPath()}/package.json`);
      const { createCodexAgent } = requireApp("./electron/codex-agent.cjs");
      const { runCodeModeFixture } = requireApp(fixture);
      return runCodeModeFixture({
        createCodexAgent,
        root: `${root}/code-mode-check`,
      });
    },
    { root, fixture: path.resolve("tests/code-mode-fixture.cjs") },
  );
  assert.equal(codeMode.model, "gpt-6-astra");
  assert.ok(codeMode.pdfBytes > 0);
  console.log(
    "PASS: bundled gpt-6-astra Code Mode host executed real LaTeX compilation, repaired two files, and produced a PDF using local model-response fixtures.",
  );
  await page.screenshot({ path: "output/playwright/ai-sign-in.png" });

  if (process.env.RESEARCH_TEST_AUTH_NETWORK === "1") {
    // Exercise the production login setup against public metadata only. Capture the
    // browser URL so this check cannot log in, grant permissions, or use a model.
    await desktop.evaluate(({ shell }) => {
      globalThis.__aiAuthProbe = { original: shell.openExternal, url: null };
      shell.openExternal = async (url) => {
        globalThis.__aiAuthProbe.url = url;
      };
    });
    try {
      await page
        .getByRole("button", { name: "Continue with ChatGPT", exact: false })
        .click();
      const authorization = await desktop.evaluate(async () => {
        for (let i = 0; i < 100; i++) {
          const value = globalThis.__aiAuthProbe.url;
          if (value) {
            const url = new URL(value);
            return {
              endpoint: `${url.origin}${url.pathname}`,
              client: url.searchParams.get("client_id"),
              callbackHost: new URL(url.searchParams.get("redirect_uri"))
                .hostname,
              pkce: url.searchParams.get("code_challenge_method"),
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return null;
      });
      const current = await page.evaluate(
        async () => (await window.research.aiState()).value,
      );
      assert.ok(
        authorization,
        current.error?.message ||
          "The production sign-in setup did not reach the browser",
      );
      assert.deepEqual(authorization, {
        endpoint: "https://auth.openai.com/api/accounts/authorize",
        client: "dynamic_agent_client",
        callbackHost: "127.0.0.1",
        pkce: "S256",
      });
      assert.equal(current.status, "connecting");
      console.log(
        "PASS: production Electron networking fetched real OpenAI discovery and reached PKCE browser authorization without logging in.",
      );
    } finally {
      await page.evaluate(() => window.research.aiCancelSignIn());
      await desktop.evaluate(({ shell }) => {
        shell.openExternal = globalThis.__aiAuthProbe.original;
        delete globalThis.__aiAuthProbe;
      });
    }
  }

  // Replace only this isolated process's AI handlers. Production has no fixture mode.
  // Backend tests exercise OAuth validation and the real JSON-RPC adapter separately.
  await desktop.evaluate(async ({ ipcMain, BrowserWindow }, folder) => {
    const { writeFile } = process.getBuiltinModule("node:fs/promises");
    const state = {
      status: "disconnected",
      sharing: false,
      activeProfileId: null,
      profiles: [],
      models: [],
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        unreportedRequests: 0,
      },
      runtime: { available: true, version: "0.160.0" },
    };
    let conversation = {
      projectId: "ai-ui-project",
      profileId: null,
      messages: [],
    };
    let attempts = 0,
      turns = 0;
    const emit = (channel, value) =>
      BrowserWindow.getAllWindows()[0].webContents.send(`ai:${channel}`, value);
    const ok = (value) => ({ ok: true, value });
    const connected = () => {
      Object.assign(state, {
        status: "connected",
        sharing: true,
        activeProfileId: "fixture-account",
        profiles: [
          {
            id: "fixture-account",
            label: "researcher@example.test",
            status: "connected",
            sharing: true,
          },
        ],
        models: [
          { slug: "fixture-model", displayName: "Research Model" },
          { slug: "fixture-model-2", displayName: "Fast Model" },
        ],
      });
      conversation.profileId = state.activeProfileId;
      emit("state", state);
    };
    const handlers = {
      "ai:state": () => ok(state),
      "ai:conversation": () => ok(conversation),
      "ai:models": () => ok(state),
      "ai:sign-in": () => {
        if (++attempts === 1) {
          state.status = "connecting";
          emit("state", state);
        } else connected();
        return ok(state);
      },
      "ai:cancel-sign-in": () => {
        state.status = "disconnected";
        emit("state", state);
        return ok(state);
      },
      "ai:send": (_, request) => {
        globalThis.__workbenchAITest.lastRequest = request;
        turns++;
        conversation.messages.push(
          {
            id: `user-${turns}`,
            role: "user",
            text: request.message,
            status: "completed",
            createdAt: new Date().toISOString(),
            attachments: request.context
              ? [{ name: request.context.file, kind: request.context.kind }]
              : [],
          },
          {
            id: `assistant-${turns}`,
            role: "assistant",
            model: request.model,
            text: "I will inspect the manuscript and run its checks.",
            status: "running",
            createdAt: new Date().toISOString(),
            activities: [],
            approvals:
              turns === 1
                ? [
                    {
                      id: "approval-fixture",
                      kind: "command",
                      command: "node check.cjs",
                      cwd: folder,
                      reason: "Run the project's validation script",
                      canAccept: true,
                    },
                  ]
                : [],
          },
        );
        emit("conversation", conversation);
        return ok(conversation);
      },
      "ai:answer": async (_, request) => {
        assertDecision(request);
        const message = conversation.messages.at(-1);
        message.approvals = [];
        await writeFile(
          `${folder}/main.tex`,
          "Revised manuscript from agent\n",
        );
        await writeFile(
          `${folder}/check.cjs`,
          "console.log('checks passed');\n",
        );
        Object.assign(message, {
          status: "completed",
          text: "修改完成。Updated two files and ran the project checks.",
          activities: [
            {
              id: "command",
              type: "commandExecution",
              command: "node check.cjs",
              cwd: folder,
              status: "completed",
              output: "checks passed\n",
              exitCode: 0,
            },
            {
              id: "files",
              type: "fileChange",
              status: "completed",
              changes: [
                {
                  path: "main.tex",
                  kind: { type: "update" },
                  diff: "-Original manuscript\n+Revised manuscript from agent",
                },
                {
                  path: "check.cjs",
                  kind: { type: "add" },
                  diff: "+console.log('checks passed');",
                },
              ],
            },
          ],
          diff: "--- main.tex\n+++ main.tex\n-Original manuscript\n+Revised manuscript from agent",
          usage: { inputTokens: 200, outputTokens: 80 },
        });
        state.usage = {
          requests: 1,
          inputTokens: 200,
          outputTokens: 80,
          unreportedRequests: 0,
        };
        emit("conversation", conversation);
        emit("state", state);
        return ok();
      },
      "ai:stop": () => {
        Object.assign(conversation.messages.at(-1), {
          status: "cancelled",
          approvals: [],
          error: {
            code: "cancelled",
            message:
              "Agent stopped. Review any files it changed before stopping.",
          },
        });
        emit("conversation", conversation);
        return ok(conversation);
      },
      "ai:clear": () => {
        conversation = { ...conversation, messages: [] };
        emit("conversation", conversation);
        return ok(conversation);
      },
      "ai:open-usage": () => {
        globalThis.__workbenchAITest.usageOpened = true;
        return ok();
      },
    };
    function assertDecision(request) {
      if (request.id !== "approval-fixture" || request.decision !== "accept")
        throw new Error("Unexpected UI approval decision");
    }
    globalThis.__workbenchAITest = { lastRequest: null, usageOpened: false };
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    }
  }, folder);

  await page
    .getByRole("button", { name: "Continue with ChatGPT", exact: false })
    .click();
  await page
    .getByText("Finish sign-in in your browser", { exact: false })
    .waitFor();
  await page
    .locator(".ai-connect-actions")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue with ChatGPT", exact: false })
    .click();
  await page.getByLabel("AI model").selectOption("fixture-model-2");
  await page
    .getByLabel("Message the AI agent")
    .fill("Fix the manuscript and run the checks");
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await page.locator(".xterm").waitFor({ state: "visible" });
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "AI", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Message the AI agent").inputValue(),
    "Fix the manuscript and run the checks",
  );
  await page.locator(".cm-content").fill("Unsaved manuscript changes\n");
  await page.getByRole("button", { name: "Current file", exact: true }).click();
  await page.getByRole("button", { name: "Run AI agent", exact: true }).click();
  await page.getByRole("button", { name: "Allow once", exact: true }).waitFor();
  assert.equal(
    await fs.readFile(path.join(folder, "main.tex"), "utf8"),
    "Unsaved manuscript changes\n",
    "Save the editor before running the agent",
  );
  assert.equal(
    await page.locator(".cm-content").getAttribute("contenteditable"),
    "false",
  );
  const sent = await desktop.evaluate(
    () => globalThis.__workbenchAITest.lastRequest,
  );
  assert.equal(sent.model, "fixture-model-2");
  assert.equal(sent.context.text, "Unsaved manuscript changes\n");
  await page.screenshot({ path: "output/playwright/ai-approval.png" });
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await page
    .getByText("修改完成。Updated two files and ran the project checks.", {
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector(".cm-content")
      ?.textContent.includes("Revised manuscript from agent"),
  );
  assert.equal(
    await page.locator(".cm-content").getAttribute("contenteditable"),
    "true",
  );
  assert.equal(
    await page.getByRole("button", { name: "check.cjs", exact: true }).count(),
    1,
  );
  await page.locator(".ai-activity").first().locator("summary").click();
  await page.getByText("checks passed", { exact: true }).waitFor();
  await page.locator(".ai-turn-diff summary").click();
  assert.match(
    await page.locator(".ai-turn-diff pre").innerText(),
    /Revised manuscript from agent/,
  );
  await page.screenshot({ path: "output/playwright/ai-agent.png" });
  await page
    .locator(".ai-toolbar")
    .getByRole("button", { name: "Usage", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open ChatGPT Usage", exact: true })
    .click();
  assert.equal(
    await desktop.evaluate(() => globalThis.__workbenchAITest.usageOpened),
    true,
  );
  assert.equal(
    await page
      .locator(".ai-local-usage dd")
      .allTextContents()
      .then((v) => v.join(",")),
    "1,200,80",
  );
  await page.screenshot({ path: "output/playwright/ai-usage.png" });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1050, 760),
  );
  await page.waitForTimeout(300);
  const fits = await page.evaluate(() => {
    const p = document.querySelector(".ai-panel");
    return p.scrollWidth <= p.clientWidth + 1;
  });
  assert.equal(fits, true, "AI panel should fit the compact window");
  await page.screenshot({ path: "output/playwright/ai-agent-dark.png" });
  await page.getByLabel("Message the AI agent").fill("Run another check");
  await page.getByRole("button", { name: "Run AI agent", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop AI agent", exact: true })
    .click();
  await page
    .getByText("Agent stopped. Review any files it changed before stopping.", {
      exact: true,
    })
    .waitFor();
  await page.getByTitle("New AI chat", { exact: true }).click();
  await page.getByText("What should we work on?", { exact: true }).waitFor();
  assert.deepEqual(failures, []);
  console.log(
    "PASS: bundled Codex discovery, ChatGPT connection/cancel, model selection, saved draft across tabs, save before run, editor lock, approvals, command output, multi-file refresh, diff, usage, stop, new chat, and compact dark layout.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: "output/playwright/ai-failure.png" })
    .catch(() => {});
  console.error(
    await page
      ?.locator("body")
      .innerText()
      .catch(() => ""),
  );
  throw error;
} finally {
  await desktop?.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
