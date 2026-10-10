import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { launchApp, resizeWindow, smoke } from "./smoke-harness.mjs";

await smoke("ai", async (root) => {
  const folder = path.join(root, "manuscript");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "main.tex"), "Original manuscript\n");
  const { app: desktop, page } = await launchApp({ dataDirectory: root });
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
  await page.evaluate(() =>
    localStorage.setItem(
      "research-workbench.panels.v1",
      JSON.stringify({ terminal: 120 }),
    ),
  );
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Agent Integration", exact: true })
    .click();
  await page.locator(".cm-content").waitFor({ state: "attached" });
  const mode = (name) =>
    page
      .getByRole("group", { name: "Workbench mode" })
      .getByRole("button", { name, exact: true });
  assert.equal(await mode("Agent + PDF").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".editor-pane").isVisible(), false);
  const columns = await page.evaluate(() => {
    const pdf = document.querySelector(".pdf-pane").getBoundingClientRect();
    const chat = document
      .querySelector(".bottom-panel")
      .getBoundingClientRect();
    return {
      adjacent: chat.right <= pdf.left,
      height: chat.height,
      bottom: chat.bottom,
      viewport: innerHeight,
    };
  });
  assert.ok(
    columns.adjacent &&
      columns.height > 500 &&
      columns.bottom <= columns.viewport,
  );
  await mode("Source + PDF").click();
  assert.equal(await page.locator(".editor-pane").isVisible(), true);
  assert.equal(await page.locator(".ai-panel").isVisible(), false);
  await mode("All panels").click();
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  const terminalPanelHeight = (
    await page.locator(".bottom-panel").boundingBox()
  ).height;
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "AI", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue with ChatGPT", exact: false })
    .waitFor();
  const initialAIHeight = (await page.locator(".bottom-panel").boundingBox())
    .height;
  assert.ok(
    initialAIHeight >= 340 && initialAIHeight > terminalPanelHeight + 100,
    "AI must not inherit a collapsed terminal's height",
  );
  assert.ok(
    (await page.locator(".ai-transcript").boundingBox()).height >= 200,
    "Default AI layout must leave readable transcript space",
  );
  const aiDivider = page.getByRole("separator", {
    name: "Resize AI panel",
    exact: true,
  });
  await aiDivider.focus();
  await aiDivider.press("Shift+ArrowUp");
  const resizedAIHeight = (await page.locator(".bottom-panel").boundingBox())
    .height;
  assert.ok(resizedAIHeight >= initialAIHeight + 49);
  assert.ok(
    (
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("research-workbench.panels.v1")),
      )
    ).ai >=
      initialAIHeight + 49,
  );
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
  const nativeSkills = await page.evaluate(async () => {
    const result = await window.research.aiSkills(
      "ai-ui-project",
      "primary",
      true,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  assert.ok(
    nativeSkills.skills.some(
      (skill) => skill.name === "scale-writing" && skill.enabled,
    ),
    "This installation must discover the user's scale-writing skill",
  );
  console.log(
    "PASS: native app-server discovered installed scale-writing without logging in or consuming model usage.",
  );
  const codeMode = await desktop.evaluate(
    async ({ app, net }, { root, fixture }) => {
      const requireApp = process
        .getBuiltinModule("node:module")
        .createRequire(`${app.getAppPath()}/package.json`);
      const { createCodexAgent } = requireApp("./electron/codex-agent.cjs");
      const { createResponseGateway } = requireApp(
        "./electron/response-gateway.cjs",
      );
      const { runCodeModeFixture } = requireApp(fixture);
      return runCodeModeFixture({
        createCodexAgent,
        createResponseGateway,
        fetcher: (url, options) => net.fetch(url, options),
        root: `${root}/code-mode-check`,
      });
    },
    { root, fixture: path.resolve("tests/code-mode-fixture.cjs") },
  );
  assert.equal(codeMode.model, "gpt-6-astra");
  assert.equal(codeMode.nativeSkill, "workbench-fixture-writing");
  assert.ok(codeMode.pdfBytes > 0);
  assert.equal(codeMode.refreshes, 1);
  console.log(
    "PASS: bundled gpt-6-astra Code Mode compiled, repaired two files, renewed an expired token through Electron's Responses gateway, and produced a PDF without replaying tools.",
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
  await desktop.evaluate(async ({ app, ipcMain, BrowserWindow }, folder) => {
    const requireApp = process
      .getBuiltinModule("node:module")
      .createRequire(app.getAppPath() + "/package.json");
    const { legacyReview } = requireApp("./electron/ai-changes.cjs");
    const { writeFile, mkdir, copyFile } =
      process.getBuiltinModule("node:fs/promises");
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
      queue: [],
      queuePaused: false,
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
          {
            slug: "fixture-model",
            displayName: "Research Model",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced" },
            ],
            serviceTiers: [],
          },
          {
            slug: "fixture-model-2",
            displayName: "Code Model",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Light" },
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
        ],
      });
      conversation.profileId = state.activeProfileId;
      emit("state", state);
    };
    const handlers = {
      "ai:state": () => ok(state),
      "ai:conversation": () => ok(conversation),
      "ai:review": (_, _id, messageId) =>
        ok(
          legacyReview(
            conversation.messages.find((message) => message.id === messageId),
          ).review,
        ),
      "ai:review-file": (_, _id, messageId, fileId) =>
        ok(
          legacyReview(
            conversation.messages.find((message) => message.id === messageId),
          ).files.find((file) => file.id === fileId),
        ),
      "ai:models": () => ok(state),
      "ai:skills": () =>
        ok({
          skills: [
            {
              id: "a".repeat(64),
              name: "scale-writing",
              displayName: "scale-writing",
              description:
                "Revise research drafts using relevant Best Paper and Test of Time exemplars while preserving supported claims.",
              scope: "user",
              enabled: true,
            },
            {
              id: "c".repeat(64),
              name: "system-checks",
              displayName: "Project checks",
              description: "Run local project checks and report results.",
              scope: "repo",
              enabled: true,
            },
            {
              id: "b".repeat(64),
              name: "disabled-fixture",
              displayName: "Disabled fixture",
              description: "Disabled skills cannot be selected.",
              scope: "repo",
              enabled: false,
            },
          ],
          warnings: 0,
        }),
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
            skills: request.skillIds?.includes("a".repeat(64))
              ? [{ name: "scale-writing", displayName: "scale-writing" }]
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
                      kind: "permissions",
                      command: "node check.cjs",
                      cwd: folder,
                      reason: "Run the project's validation script",
                      permissions: {
                        network: { enabled: true },
                        fileSystem: {
                          write: [
                            process
                              .getBuiltinModule("node:path")
                              .join(folder, ".git"),
                          ],
                        },
                      },
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
        await mkdir(`${folder}/.research-build`, { recursive: true });
        await copyFile(
          `${folder}/../code-mode-check/manuscript/.research-build/main.pdf`,
          `${folder}/.research-build/main.pdf`,
        );
        Object.assign(message, {
          status: "completed",
          text: `## Manuscript compiled\n\n修改完成。Updated two files and ran the project checks.\n\nThe manuscript now compiles successfully: [Compiled PDF](<${folder}/.research-build/main.pdf>).\n\nFixed the build in [main.tex](<${folder}/main.tex:1>):\n\n- Removed the conflicting \`amssymb\` package.\n- Defined the missing \`reviewercomment\` environment.\n\nVerified with:\n\n\`\`\`sh\nlatexmk -pdf -halt-on-error -no-shell-escape main.tex\n\`\`\`\n\nRun [check.cjs](<${folder}/check.cjs:1>) to inspect the validation script.\n\n| Check | Result |\n| --- | --- |\n| LaTeX build | Passed |\n| Project script | Passed |\n\n[Unsafe link](javascript:alert%281%29)\n\n<script>throw new Error('unsafe markdown')</script>`,
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
        conversation.queuePaused = true;
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
        conversation = {
          ...conversation,
          messages: [],
          queue: [],
          queuePaused: false,
        };
        pendingRequests.clear();
        emit("conversation", conversation);
        return ok(conversation);
      },
      "ai:open-usage": () => {
        globalThis.__workbenchAITest.usageOpened = true;
        return ok();
      },
    };
    const pendingRequests = new Map();
    const startRequest = handlers["ai:send"];
    let queuedId = 0;
    const startNext = () => {
      if (
        conversation.queuePaused ||
        conversation.messages.at(-1)?.status === "running" ||
        !conversation.queue.length
      )
        return;
      const item = conversation.queue.shift();
      const request = pendingRequests.get(item.id);
      pendingRequests.delete(item.id);
      startRequest(null, request);
    };
    handlers["ai:send"] = (_, request) => {
      if (
        conversation.messages.at(-1)?.status !== "running" &&
        !conversation.queue.length
      ) {
        conversation.queuePaused = false;
        return startRequest(null, request);
      }
      const item = {
        id: `queued-${++queuedId}`,
        text: request.message,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        serviceTier: request.serviceTier,
        permissionMode: request.permissionMode,
        createdAt: new Date().toISOString(),
        attachments: request.context
          ? [{ name: request.context.file, kind: request.context.kind }]
          : [],
        skills: request.skillIds?.includes("a".repeat(64))
          ? [{ name: "scale-writing", displayName: "scale-writing" }]
          : [],
      };
      globalThis.__workbenchAITest.lastQueuedRequest = request;
      pendingRequests.set(item.id, request);
      conversation.queue.push(item);
      emit("conversation", conversation);
      return ok(conversation);
    };
    handlers["ai:queue"] = (_, { action, id, direction }) => {
      if (action === "pause") conversation.queuePaused = true;
      if (action === "resume") conversation.queuePaused = false;
      const index = conversation.queue.findIndex((item) => item.id === id);
      if (action === "remove") {
        conversation.queue.splice(index, 1);
        pendingRequests.delete(id);
      }
      if (action === "move")
        [conversation.queue[index], conversation.queue[index + direction]] = [
          conversation.queue[index + direction],
          conversation.queue[index],
        ];
      startNext();
      emit("conversation", conversation);
      return ok(conversation);
    };
    function assertDecision(request) {
      if (request.id !== "approval-fixture" || request.decision !== "accept")
        throw new Error("Unexpected UI approval decision");
    }
    globalThis.__workbenchAITest = { lastRequest: null, usageOpened: false };
    globalThis.__workbenchAITest.finish = () => {
      conversation.messages.at(-1).status = "completed";
      startNext();
      emit("conversation", conversation);
    };
    globalThis.__workbenchAITest.delta = (delta, snapshot = false) => {
      const message = conversation.messages.at(-1);
      message.text += delta;
      emit("delta", {
        projectId: conversation.projectId,
        profileId: conversation.profileId,
        requestId: message.id,
        delta,
      });
      // The agent sends either the whole chat or only its running message.
      if (snapshot === "message")
        emit("message", {
          projectId: conversation.projectId,
          profileId: conversation.profileId,
          message,
        });
      else if (snapshot) emit("conversation", conversation);
    };
    globalThis.__workbenchAITest.cleanPreview = () => {
      const message = conversation.messages.at(-1);
      message.text = message.text.split("\n\n[Unsafe link]")[0];
      emit("conversation", conversation);
    };
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
  await page
    .getByRole("button", { name: "Agent permissions", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Full access", exact: false })
    .click();
  assert.match(
    await page
      .getByRole("button", { name: "Agent permissions", exact: true })
      .innerText(),
    /Full access/,
  );
  await page
    .getByRole("button", { name: "Agent permissions", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Read only", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Agent permissions", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Approve for me", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Agent permissions", exact: true })
    .click();
  await page.keyboard.press("ArrowUp");
  assert.equal(
    await page
      .getByRole("menuitemradio", { name: "Default permissions", exact: false })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "AI model", exact: true }).click();
  await page.getByRole("radio", { name: "Code Model", exact: true }).click();
  const effortSlider = page.getByRole("slider", {
    name: "Reasoning effort",
    exact: true,
  });
  assert.equal(
    await page
      .getByRole("radiogroup", { name: "Reasoning effort", exact: true })
      .count(),
    0,
  );
  await effortSlider.focus();
  await effortSlider.press("End");
  assert.equal(await effortSlider.getAttribute("aria-valuetext"), "Extra High");
  await page
    .getByRole("button", { name: "Reset reasoning effort", exact: true })
    .click();
  assert.equal(await effortSlider.getAttribute("aria-valuetext"), "Low");
  await effortSlider.focus();
  await effortSlider.press("ArrowRight");
  assert.equal(await effortSlider.getAttribute("aria-valuetext"), "Extra High");
  const sliderBox = await effortSlider.boundingBox();
  await page.mouse.click(sliderBox.x + 3, sliderBox.y + sliderBox.height / 2);
  assert.equal(await effortSlider.getAttribute("aria-valuetext"), "Low");
  await page.mouse.move(sliderBox.x + 10, sliderBox.y + sliderBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    sliderBox.x + sliderBox.width - 10,
    sliderBox.y + sliderBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.equal(await effortSlider.getAttribute("aria-valuetext"), "Extra High");
  await page.getByRole("radio", { name: "Fast", exact: true }).click();
  await page.waitForFunction(() => {
    const thumb = document
      .querySelector(".ai-effort-thumb")
      ?.getBoundingClientRect();
    const track = document
      .querySelector(".ai-effort-track")
      ?.getBoundingClientRect();
    return thumb && track && Math.abs(thumb.right - track.right) < 1;
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".ai-effort-thumb")
      .evaluate((node) => getComputedStyle(node).transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.screenshot({ path: "output/playwright/ai-model-settings.png" });
  await page
    .getByRole("radio", { name: "Research Model", exact: true })
    .click();
  assert.equal(await effortSlider.getAttribute("aria-valuetext"), "Medium");
  assert.equal(await effortSlider.isDisabled(), true);
  assert.equal(
    await page.getByRole("radio", { name: "Fast", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("radio", { name: "Standard", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.getByRole("radio", { name: "Code Model", exact: true }).click();
  assert.equal(await effortSlider.getAttribute("aria-valuetext"), "Extra High");
  assert.equal(
    await page
      .getByRole("radio", { name: "Fast", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "AI model", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  const fastToggle = page.getByRole("button", {
    name: "Fast mode",
    exact: true,
  });
  assert.equal(
    await fastToggle.innerText(),
    "",
    "Speed uses an icon without a Fast label",
  );
  assert.equal(await fastToggle.getAttribute("aria-pressed"), "true");
  assert.equal(
    await page
      .locator(".ai-model-controls > button")
      .first()
      .getAttribute("aria-label"),
    "Fast mode",
  );
  assert.match(
    await page
      .getByRole("button", { name: "AI model", exact: true })
      .innerText(),
    /^Code Model\s*Extra High/,
  );
  await fastToggle.click();
  assert.equal(await fastToggle.getAttribute("aria-pressed"), "false");
  await fastToggle.focus();
  await fastToggle.press("Space");
  assert.equal(await fastToggle.getAttribute("aria-pressed"), "true");
  await page
    .getByRole("button", { name: "Agent permissions", exact: true })
    .click();
  await page.screenshot({
    path: "output/playwright/ai-permission-settings.png",
  });
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Agent Integration", exact: true })
    .click();
  await mode("All panels").click();
  assert.match(
    await page
      .getByRole("button", { name: "Agent permissions", exact: true })
      .innerText(),
    /Approve for me/,
  );
  assert.match(
    await page
      .getByRole("button", { name: "AI model", exact: true })
      .innerText(),
    /Code Model.*Extra High/s,
  );
  assert.equal(
    await fastToggle.getAttribute("aria-pressed"),
    "true",
    "Fast mode persists after reload",
  );
  await page.getByRole("button", { name: "AI model", exact: true }).click();
  assert.equal(
    await page
      .getByRole("radio", { name: "Fast", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.getByLabel("Message the AI agent").click();
  assert.equal(
    await page
      .getByRole("dialog", { name: "AI model settings", exact: true })
      .count(),
    0,
  );
  await page.getByLabel("Message the AI agent").press("$");
  await page.getByRole("dialog", { name: "Choose skills" }).waitFor();
  assert.equal(await page.getByLabel("Message the AI agent").inputValue(), "");
  await page
    .getByRole("button", { name: "Refresh skills", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select disabled-fixture", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Select disabled-fixture", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel("Find a skill").fill("scale");
  assert.equal(await page.locator(".ai-skill-option").count(), 1);
  await page
    .getByRole("button", { name: "Select scale-writing", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Select scale-writing", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: "output/playwright/ai-skills-picker.png" });
  await page.getByRole("button", { name: "Close skills", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove scale-writing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose skills", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select scale-writing", exact: true })
    .click();
  await page.getByLabel("Find a skill").press("Escape");
  await page
    .getByRole("dialog", { name: "Choose skills" })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Remove scale-writing", exact: true })
    .click();
  const slashComposer = page.getByLabel("Message the AI agent");
  const suggestions = page.getByRole("listbox", {
    name: "Skill suggestions",
    exact: true,
  });
  await slashComposer.fill("/");
  await suggestions.waitFor();
  assert.equal(
    await suggestions.getByRole("option").count(),
    2,
    "Slash suggestions include enabled skills only",
  );
  assert.equal(
    await slashComposer.evaluate((node) => node === document.activeElement),
    true,
  );
  await slashComposer.press("ArrowDown");
  assert.equal(
    await suggestions
      .getByRole("option", { name: "Select system-checks", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await slashComposer.press("ArrowDown");
  assert.equal(
    await suggestions
      .getByRole("option", { name: "Select scale-writing", exact: true })
      .getAttribute("aria-selected"),
    "true",
    "Navigation wraps to the first skill",
  );
  await slashComposer.press("Enter");
  await suggestions.waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Remove scale-writing", exact: true })
    .waitFor();
  assert.equal(await slashComposer.inputValue(), "");
  assert.equal(
    await desktop.evaluate(() => globalThis.__workbenchAITest.lastRequest),
    null,
    "Enter selects the skill without sending a request",
  );
  await slashComposer.fill("/sca");
  await suggestions
    .getByRole("option", { name: "Select scale-writing", exact: true })
    .waitFor();
  await slashComposer.press("Tab");
  await suggestions.waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("button", { name: "Remove scale-writing", exact: true })
      .count(),
    1,
    "Selecting an attached skill keeps one chip",
  );
  await page
    .getByRole("button", { name: "Remove scale-writing", exact: true })
    .click();
  await slashComposer.fill("Please /sca keep this text");
  await slashComposer.evaluate((node) => {
    node.setSelectionRange(11, 11);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await suggestions
    .getByRole("option", { name: "Select scale-writing", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".ai-skill-suggestions"))
        .opacity === "1",
  );
  await page.screenshot({ path: "output/playwright/ai-slash-skills.png" });
  await suggestions
    .getByRole("option", { name: "Select scale-writing", exact: true })
    .click();
  await suggestions.waitFor({ state: "detached" });
  assert.equal(
    await slashComposer.inputValue(),
    "Please keep this text",
    "Selection preserves the surrounding request",
  );
  await page.waitForFunction(() => {
    const node = document.querySelector(".ai-composer textarea");
    return node === document.activeElement && node.selectionStart === 7;
  });
  await page
    .getByRole("button", { name: "Remove scale-writing", exact: true })
    .click();
  await slashComposer.fill("/unknown-skill");
  await suggestions
    .getByText("No matching skills.", { exact: false })
    .waitFor();
  await slashComposer.press("Enter");
  assert.equal(
    await desktop.evaluate(() => globalThis.__workbenchAITest.lastRequest),
    null,
    "An empty suggestion list cannot send accidentally",
  );
  await slashComposer.press("Escape");
  await suggestions.waitFor({ state: "detached" });
  await slashComposer.press("ArrowLeft");
  assert.equal(
    await suggestions.count(),
    0,
    "Escape keeps the current token dismissed",
  );
  assert.equal(await slashComposer.inputValue(), "/unknown-skill");
  for (const text of [
    "https://example.test/scale",
    "/Users/research/main.tex",
    "Discuss source/PDF navigation",
  ]) {
    await slashComposer.fill(text);
    assert.equal(
      await suggestions.count(),
      0,
      "Paths and URLs stay ordinary request text",
    );
  }
  await slashComposer.fill("/sca");
  await suggestions.waitFor();
  await slashComposer.evaluate((node) =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  assert.equal(
    await suggestions.count(),
    1,
    "IME confirmation keeps the suggestion open",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Remove scale-writing", exact: true })
      .count(),
    0,
  );
  await slashComposer.press("Enter");
  await suggestions.waitFor({ state: "detached" });
  await page
    .getByLabel("Message the AI agent")
    .fill("Fix the manuscript and run the checks");
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await page.locator(".xterm").waitFor({ state: "visible" });
  assert.equal(
    (await page.locator(".bottom-panel").boundingBox()).height,
    terminalPanelHeight,
    "Resizing AI must preserve the terminal's height",
  );
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "AI", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Message the AI agent").inputValue(),
    "Fix the manuscript and run the checks",
  );
  assert.equal(
    (await page.locator(".bottom-panel").boundingBox()).height,
    resizedAIHeight,
    "AI must remember its height when switching tabs",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Remove scale-writing", exact: true })
      .count(),
    1,
    "Skill selection survives switching between Terminal and AI",
  );
  await page.locator(".cm-content").fill("Unsaved manuscript changes\n");
  const sourceBeforeModeSwitch = await page.locator(".cm-content").innerText();
  await page.evaluate(() => {
    window.__modeEditor = document.querySelector(".cm-content");
    window.__modeComposer = document.querySelector(".ai-composer textarea");
  });
  await mode("Agent + PDF").click();
  await mode("Source + PDF").click();
  await mode("All panels").click();
  assert.equal(
    await page.locator(".cm-content").innerText(),
    sourceBeforeModeSwitch,
  );
  assert.equal(
    await page.getByLabel("Message the AI agent").inputValue(),
    "Fix the manuscript and run the checks",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__modeEditor === document.querySelector(".cm-content") &&
        window.__modeComposer ===
          document.querySelector(".ai-composer textarea"),
    ),
    true,
    "Mode changes must preserve the mounted editor and composer",
  );
  await page.getByRole("button", { name: "Current file", exact: true }).click();
  const composer = page.getByLabel("Message the AI agent");
  await composer.evaluate((node) =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  assert.equal(
    await desktop.evaluate(() => globalThis.__workbenchAITest.lastRequest),
    null,
    "IME confirmation must not send the message",
  );
  await composer.press("End");
  await composer.press("Shift+Enter");
  await page.keyboard.insertText("Tell me what changed.");
  assert.match(await composer.inputValue(), /\nTell me what changed/);
  assert.ok(
    (await composer.boundingBox()).height > 30,
    "Composer should grow with the draft",
  );
  await composer.press("Enter");
  await page
    .getByRole("button", { name: "Allow for this turn", exact: true })
    .waitFor();
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
  assert.equal(sent.permissionMode, "auto-review");
  assert.equal(sent.reasoningEffort, "xhigh");
  assert.equal(sent.serviceTier, "priority");
  assert.equal(
    await page
      .getByRole("button", { name: "Agent permissions", exact: true })
      .isDisabled(),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "AI model", exact: true })
      .isDisabled(),
    false,
  );
  assert.deepEqual(sent.skillIds, ["a".repeat(64)]);
  assert.equal(
    await page.locator(".ai-selected-skills").count(),
    0,
    "Selection applies to one message",
  );
  assert.equal(
    await page.locator(".ai-message-skills").innerText(),
    "scale-writing",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Choose skills", exact: true })
      .isDisabled(),
    false,
  );
  assert.equal(sent.context.text, "Unsaved manuscript changes\n");
  await page
    .getByText("Network access for this turn", { exact: true })
    .waitFor();
  assert.match(
    await page.locator(".ai-approval").innerText(),
    /Write: .*\.git/,
  );
  await page.screenshot({ path: "output/playwright/ai-approval.png" });
  await page
    .getByRole("button", { name: "Allow for this turn", exact: true })
    .click();
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
  await page.waitForFunction(
    () =>
      document.querySelector(".cm-content")?.getAttribute("contenteditable") ===
      "true",
  );
  assert.equal(
    await page.locator(".cm-content").getAttribute("contenteditable"),
    "true",
  );
  assert.equal(
    await page
      .locator(".file-sidebar")
      .getByRole("button", { name: "check.cjs", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.locator(".ai-markdown h2").innerText(),
    "Manuscript compiled",
  );
  assert.equal(await page.locator(".ai-markdown li").count(), 2);
  assert.equal(await page.locator(".ai-markdown table").count(), 1);
  assert.equal(
    await page
      .locator(".ai-markdown a[href^='javascript:'], .ai-markdown script")
      .count(),
    0,
  );
  await desktop.evaluate(() => globalThis.__workbenchAITest.cleanPreview());
  await page
    .getByText("Unsafe link", { exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page.locator(".ai-work-log").getAttribute("open"),
    null,
    "Execution details should start collapsed",
  );
  assert.match(
    await page.locator(".ai-work-log > summary").innerText(),
    /1 command · 2 files changed/,
  );
  await page.locator(".ai-work-log > summary").click();
  await page.locator(".ai-activity").first().locator("summary").click();
  await page.getByText("checks passed", { exact: true }).waitFor();
  await page.locator(".ai-review-button").first().click();
  await page.locator(".ai-saved-patch").waitFor();
  assert.match(
    await page.locator(".ai-saved-patch").innerText(),
    /Revised manuscript from agent/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Revert this run", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".ai-work-log > summary").click();
  await page.getByTitle("Expand AI panel", { exact: true }).click();
  assert.equal(await page.locator(".workbench-panes").isVisible(), false);
  await page.locator(".ai-transcript").evaluate((node) => (node.scrollTop = 0));
  await page.screenshot({ path: "output/playwright/ai-chat-expanded.png" });
  await page
    .locator(".ai-panel")
    .screenshot({ path: "output/playwright/ai-conversation-preview.png" });
  // Capture copying without changing the user's system clipboard.
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text) => {
        window.__aiCopiedCode = text;
      },
    }),
  );
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__aiCopiedCode),
    "latexmk -pdf -halt-on-error -no-shell-escape main.tex\n",
  );
  await page.getByRole("link", { name: "check.cjs", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".cm-content")
      ?.textContent.includes("console.log('checks passed')"),
  );
  assert.equal(
    await page.locator(".workbench-panes").isVisible(),
    true,
    "Opening a file should restore split view",
  );
  await page.getByRole("link", { name: "Compiled PDF", exact: true }).click();
  await page.getByLabel("PDF page 1", { exact: true }).waitFor();
  await page.getByRole("link", { name: "main.tex", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".cm-content")
      ?.textContent.includes("Revised manuscript from agent"),
  );
  await page.screenshot({ path: "output/playwright/ai-agent.png" });
  assert.ok(
    (await page.locator(".ai-transcript").boundingBox()).height >= 200,
    "A completed reply must retain readable space in split view",
  );
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
  await resizeWindow(desktop, page, 1050, 760);
  await page.waitForTimeout(300);
  assert.ok(
    (await page.locator(".ai-transcript").boundingBox()).height >= 200,
    "A smaller laptop window must still show the conversation",
  );
  const visibleChat = await page.evaluate(() => {
    const transcript = document
      .querySelector(".ai-transcript")
      .getBoundingClientRect();
    const composer = document
      .querySelector(".ai-composer")
      .getBoundingClientRect();
    return {
      top: transcript.top,
      bottom: composer.bottom,
      viewport: innerHeight,
      font: getComputedStyle(document.documentElement).fontFamily,
      layout: getComputedStyle(document.querySelector(".workbench")).display,
    };
  });
  assert.equal(
    visibleChat.layout,
    "flex",
    "The packaged workbench layout stylesheet must load",
  );
  assert.match(
    visibleChat.font,
    /Inter|system|sans-serif/,
    "The packaged design tokens must load",
  );
  assert.ok(
    visibleChat.top >= 0 && visibleChat.bottom <= visibleChat.viewport,
    "Chat and composer must remain inside the visible window",
  );
  const fits = await page.evaluate(() => {
    const p = document.querySelector(".ai-panel");
    return p.scrollWidth <= p.clientWidth + 1;
  });
  assert.equal(fits, true, "AI panel should fit the compact window");
  await page.screenshot({ path: "output/playwright/ai-agent-dark.png" });
  await page.getByRole("button", { name: "AI model", exact: true }).click();
  const settingsBox = await page
    .getByRole("dialog", { name: "AI model settings", exact: true })
    .boundingBox();
  assert.ok(
    settingsBox.x >= 0 &&
      settingsBox.y >= 0 &&
      settingsBox.x + settingsBox.width <= 1050 &&
      settingsBox.y + settingsBox.height <= 760,
    "Settings fit the compact window",
  );
  await page.screenshot({
    path: "output/playwright/ai-model-settings-dark.png",
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__modePDF = document.querySelector(".pdf-reader");
  });
  await mode("Agent + PDF").click();
  assert.equal(
    await page.evaluate(
      () => window.__modePDF === document.querySelector(".pdf-reader"),
    ),
    true,
    "PDF reader must stay mounted across modes",
  );
  await page.locator(".ai-transcript").evaluate((node) => (node.scrollTop = 0));
  await page.waitForTimeout(300);
  const sideFits = await page.evaluate(() => {
    const chat = document
      .querySelector(".ai-transcript")
      .getBoundingClientRect();
    const composer = document
      .querySelector(".ai-composer")
      .getBoundingClientRect();
    const panel = document.querySelector(".ai-panel");
    return (
      chat.height > 300 &&
      composer.bottom <= innerHeight &&
      panel.scrollWidth <= panel.clientWidth + 1
    );
  });
  assert.ok(
    sideFits,
    "Agent + PDF should provide a full-height conversation even in a compact window",
  );
  await page.screenshot({ path: "output/playwright/pdf-agent-compact.png" });
  await page.getByTitle("Expand AI panel", { exact: true }).click();
  assert.equal(await page.locator(".workbench-panes").isVisible(), false);
  await page
    .locator(".bottom-tabs")
    .getByTitle("Restore split view", { exact: true })
    .click();
  await page.getByTitle("Expand PDF preview", { exact: true }).click();
  assert.equal(await page.locator(".ai-panel").isVisible(), false);
  await page
    .locator(".pdf-pane")
    .getByTitle("Restore split view", { exact: true })
    .click();
  await page.getByRole("button", { name: "Hide panel", exact: true }).click();
  assert.equal(await page.locator(".ai-panel").isVisible(), false);
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "AI", exact: true })
    .click();
  await page.getByRole("link", { name: "main.tex", exact: true }).click();
  await page.locator(".workbench.mode-combined").waitFor();
  assert.equal(
    await mode("All panels").getAttribute("aria-pressed"),
    "true",
    "Source links should reveal the editor",
  );
  await mode("Agent + PDF").click();
  await page.getByLabel("Message the AI agent").fill("Run another check");
  await page.getByRole("button", { name: "Run AI agent", exact: true }).click();
  await desktop.evaluate(() => {
    for (let i = 0; i < 50; i++)
      globalThis.__workbenchAITest.delta(
        `\n\nStreaming paragraph ${i}. 中文内容。`,
      );
    // A full snapshot arriving before the render timer must not duplicate text.
    globalThis.__workbenchAITest.delta("\n\nSnapshot checkpoint.", true);
  });
  await page
    .locator(".ai-message-assistant")
    .last()
    .getByText("Snapshot checkpoint.", { exact: true })
    .waitFor();
  assert.equal(
    (await page.locator(".ai-message-assistant").last().innerText()).match(
      /Streaming paragraph 49/g,
    )?.length,
    1,
  );
  await desktop.evaluate(() => {
    for (let i = 0; i < 20; i++)
      globalThis.__workbenchAITest.delta(`\n\nPatched paragraph ${i}.`);
    // A running-message update already holds the deltas sent before it.
    globalThis.__workbenchAITest.delta("\n\nMessage checkpoint.", "message");
  });
  await page
    .locator(".ai-message-assistant")
    .last()
    .getByText("Message checkpoint.", { exact: true })
    .waitFor();
  assert.equal(
    (await page.locator(".ai-message-assistant").last().innerText()).match(
      /Patched paragraph 19/g,
    )?.length,
    1,
  );
  await page.locator(".ai-transcript").evaluate((node) => (node.scrollTop = 0));
  await page
    .getByRole("button", { name: "Jump to latest", exact: true })
    .waitFor();
  await desktop.evaluate(() =>
    globalThis.__workbenchAITest.delta("\n\nStreamed after scrolling up."),
  );
  await page.waitForFunction(() =>
    document
      .querySelector(".ai-message-assistant:last-child")
      ?.textContent.includes("Streamed after scrolling up."),
  );
  assert.equal(
    await page.locator(".ai-transcript").evaluate((node) => node.scrollTop),
    0,
    "Streaming must preserve the reader's scroll position",
  );
  await page
    .getByRole("button", { name: "Jump to latest", exact: true })
    .click();
  assert.ok(
    await page
      .locator(".ai-transcript")
      .evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight < 5,
      ),
  );
  await composer.fill("/sca");
  await suggestions
    .getByRole("option", { name: "Select scale-writing", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".ai-skill-suggestions"))
        .opacity === "1",
  );
  const slashBox = await page.locator(".ai-skill-suggestions").boundingBox();
  const slashInputBox = await composer.boundingBox();
  assert.ok(
    slashBox.x + slashBox.width <= slashInputBox.x + slashInputBox.width + 1,
    "Suggestions stay within the compact composer",
  );
  assert.ok(
    slashBox.x >= 0 &&
      slashBox.y >= 0 &&
      slashBox.x + slashBox.width <= 1050 &&
      slashBox.y + slashBox.height <= 760,
    "Slash suggestions fit the compact window",
  );
  await page.screenshot({ path: "output/playwright/ai-slash-skills-dark.png" });
  await composer.press("Tab");
  await suggestions.waitFor({ state: "detached" });
  await composer.fill("First queued request");
  await composer.press("Enter");
  const queue = page.getByRole("region", {
    name: "Queued requests",
    exact: true,
  });
  await queue.getByText("First queued request", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector(".ai-composer textarea");
    return (
      node &&
      node.value === "" &&
      !node.readOnly &&
      node === document.activeElement
    );
  });
  assert.equal(await composer.inputValue(), "");
  assert.deepEqual(
    await desktop.evaluate(
      () => globalThis.__workbenchAITest.lastQueuedRequest.skillIds,
    ),
    ["a".repeat(64)],
    "Slash selection is captured by a queued request",
  );
  assert.equal(await page.locator(".ai-selected-skills").count(), 0);
  await page.getByRole("button", { name: "AI model", exact: true }).click();
  await page
    .getByRole("radio", { name: "Research Model", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await composer.fill("Second queued request");
  await page
    .getByRole("button", { name: "Queue message", exact: true })
    .click();
  await queue.getByText("Second queued request", { exact: true }).waitFor();
  assert.match(
    await queue.locator("li").first().innerText(),
    /Code Model · Extra High/,
  );
  assert.match(
    await queue.locator("li").last().innerText(),
    /Research Model · Medium/,
  );
  await queue
    .getByRole("button", { name: "Move queued request 2 up", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".ai-request-queue li p")?.textContent ===
      "Second queued request",
  );
  await queue
    .getByRole("button", { name: "Remove queued request 2", exact: true })
    .click();
  await queue
    .getByText("First queued request", { exact: true })
    .waitFor({ state: "detached" });
  await composer.fill("Third queued request");
  await composer.press("Enter");
  await queue.getByText("Third queued request", { exact: true }).waitFor();
  await queue
    .getByRole("button", { name: "Pause queued requests", exact: true })
    .click();
  await queue.getByText("Paused", { exact: true }).waitFor();
  await page.screenshot({
    path: "output/playwright/ai-request-queue-dark.png",
  });
  await page
    .getByRole("button", { name: "Stop AI agent", exact: true })
    .click();
  await page
    .getByText("Agent stopped. Review any files it changed before stopping.", {
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".cm-content")?.getAttribute("contenteditable") ===
      "true",
  );
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Agent Integration", exact: true })
    .click();
  await queue.getByText("Second queued request", { exact: true }).waitFor();
  await queue
    .getByRole("button", { name: "Resume queued requests", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".ai-request-queue li").length === 1,
  );
  assert.equal(
    await desktop.evaluate(
      () => globalThis.__workbenchAITest.lastRequest.message,
    ),
    "Second queued request",
  );
  await desktop.evaluate(() => globalThis.__workbenchAITest.finish());
  await queue.waitFor({ state: "detached" });
  assert.equal(
    await desktop.evaluate(
      () => globalThis.__workbenchAITest.lastRequest.message,
    ),
    "Third queued request",
  );
  await desktop.evaluate(() => globalThis.__workbenchAITest.finish());
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Stop AI agent"]'),
  );
  await page.getByTitle("New AI chat", { exact: true }).click();
  await page.getByText("What should we work on?", { exact: true }).waitFor();
  return "PASS: bundled Codex discovery, ChatGPT connection/cancel, slash skill filtering, keyboard/pointer selection, cursor and text preservation, duplicate prevention, IME/URL/path handling, skills in queued requests, permission/model/reasoning/speed selection and persistence, pointer and keyboard effort slider, reduced motion, queued submissions with captured models, queue reorder/remove/pause/restore/resume, saved drafts, save before run, editor lock, approvals, Markdown and code copy, file/PDF navigation, expandable work log, expanded AI view, IME-safe Enter/Shift+Enter, streaming snapshot consistency, scroll preservation, usage, stop, new chat, and compact dark layout.";
});
