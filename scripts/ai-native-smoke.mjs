import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { launchApp, smoke, useProject } from "./smoke-harness.mjs";

await smoke("ai-native", async (root) => {
  const folder = path.join(root, "project");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "Native controls fixture\n",
  );
  const { app, page } = await launchApp({ dataDirectory: root });
  const projectId = await useProject(page, "Native agent controls", folder);
  await app.evaluate(({ ipcMain, BrowserWindow }, projectId) => {
    const ok = (value) => ({ ok: true, value });
    const model = {
      slug: "native-fixture",
      displayName: "Native fixture",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Balanced" },
      ],
      defaultReasoningEffort: "medium",
      serviceTiers: [],
    };
    const state = {
      status: "connected",
      sharing: true,
      activeProfileId: "native-profile",
      profiles: [
        {
          id: "native-profile",
          label: "native@example.test",
          status: "connected",
          sharing: true,
        },
      ],
      models: [model],
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        unreportedRequests: 0,
      },
      runtime: { available: true },
    };
    let conversation = {
      projectId,
      profileId: "native-profile",
      chatId: "original",
      title: "Original chat",
      messages: [],
      queue: [],
    };
    const settings = { webSearch: "cached", servers: [] };
    const fixture = {
      requests: [],
      actions: [],
      answers: [],
      failSteer: false,
    };
    const emit = () =>
      BrowserWindow.getAllWindows()[0].webContents.send(
        "ai:conversation",
        conversation,
      );
    globalThis.__nativeFixture = {
      ...fixture,
      finish() {
        conversation.queuePaused = true;
        conversation.messages.at(-1).status = "completed";
        delete conversation.messages.at(-1).turnId;
        emit();
      },
      approval() {
        conversation.messages.at(-1).approvals = [
          {
            id: "mcp-approval",
            kind: "mcp",
            mode: "form",
            serverName: "papers",
            reason: "Choose the export settings",
            requestedSchema: {
              type: "object",
              required: ["label", "consent", "count"],
              properties: {
                label: { type: "string", title: "Export label" },
                consent: { type: "boolean", title: "Include notes" },
                count: {
                  type: "integer",
                  minimum: 1,
                  maximum: 5,
                  title: "Copies",
                },
              },
            },
          },
        ];
        emit();
      },
    };
    const handlers = {
      "ai:state": () => ok(state),
      "ai:models": () => ok(state),
      "ai:skills": () => ok({ skills: [], warnings: 0 }),
      "ai:conversation": () => ok(conversation),
      "ai:send": (_, request) => {
        globalThis.__nativeFixture.requests.push(request);
        if (request.delivery === "steer") {
          if (globalThis.__nativeFixture.failSteer)
            return {
              ok: false,
              error: {
                code: "turn_expired",
                message:
                  "This turn has ended. Send your message as a new request.",
              },
            };
          conversation.messages.splice(-1, 0, {
            id: `steer-${Date.now()}`,
            role: "user",
            text: request.message,
            steered: true,
            status: "completed",
            createdAt: new Date().toISOString(),
          });
        } else if (conversation.messages.at(-1)?.status === "running") {
          conversation.queue.push({
            id: `queue-${Date.now()}`,
            text: request.message,
            createdAt: new Date().toISOString(),
            model: model.slug,
            permissionMode: "default",
            serviceTier: "default",
            attachments: [],
            skills: [],
          });
        } else {
          conversation.messages.push(
            {
              id: `user-${Date.now()}`,
              role: "user",
              text: request.message,
              status: "completed",
              createdAt: new Date().toISOString(),
            },
            {
              id: `agent-${Date.now()}`,
              role: "assistant",
              text: request.reviewTarget
                ? "Native code review findings"
                : "Working…",
              status: request.reviewTarget ? "completed" : "running",
              turnId: request.reviewTarget ? undefined : "active-native-turn",
              model: model.slug,
              reviewTarget: request.reviewTarget,
              createdAt: new Date().toISOString(),
              activities: [],
            },
          );
        }
        emit();
        return ok(conversation);
      },
      "ai:answer": (_, request) => {
        globalThis.__nativeFixture.answers.push(request);
        conversation.messages.at(-1).approvals = [];
        emit();
        return ok();
      },
      "ai:chats": () =>
        ok([
          {
            id: conversation.chatId,
            title: conversation.title,
            active: true,
            archived: false,
          },
        ]),
      "ai:manage-chat": (_, _id, action) => {
        globalThis.__nativeFixture.actions.push(action);
        if (action === "fork") {
          conversation = {
            ...conversation,
            chatId: "forked",
            title: "Original chat (fork)",
            messages: conversation.messages.map((message) => ({
              ...message,
              id: `${message.id}-fork`,
              inherited: true,
            })),
            queue: [],
          };
        }
        emit();
        return ok(conversation);
      },
      "ai:native-settings": (_, _id, request = { action: "read" }) => {
        globalThis.__nativeFixture.actions.push(request);
        if (request.action === "webSearch") settings.webSearch = request.value;
        if (request.action === "addServer")
          settings.servers.push({
            name: request.name,
            enabled: true,
            toolCount: 1,
            tools: ["search_papers"],
            authStatus: "notLoggedIn",
          });
        if (request.action === "toggleServer")
          settings.servers.find(
            (server) => server.name === request.name,
          ).enabled = request.enabled;
        return ok(settings);
      },
    };
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    }
  }, projectId);
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Native agent controls", exact: true })
    .click();
  const composer = page.getByLabel("Message the AI agent", { exact: true });
  await composer.fill("Start working");
  await page.getByRole("button", { name: "Run AI agent", exact: true }).click();
  await page.getByLabel("Message delivery").waitFor();
  await composer.fill("Keep the ICLR template");
  await page
    .getByRole("button", { name: "Steer active turn", exact: true })
    .click();
  await page.getByText("Sent to the active turn", { exact: true }).waitFor();
  let requests = await app.evaluate(() => globalThis.__nativeFixture.requests);
  assert.equal(requests.at(-1).delivery, "steer");
  assert.equal(requests.at(-1).expectedTurnId, "active-native-turn");
  await app.evaluate(() => {
    globalThis.__nativeFixture.failSteer = true;
  });
  await composer.fill("Keep my failed draft");
  await page
    .getByRole("button", { name: "Steer active turn", exact: true })
    .click();
  await page
    .getByText("This turn has ended. Send your message as a new request.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await composer.inputValue(), "Keep my failed draft");
  await app.evaluate(() => {
    globalThis.__nativeFixture.failSteer = false;
  });
  await page.getByLabel("Message delivery").selectOption("queue");
  await composer.fill("Handle this after the current task");
  await page
    .getByRole("button", { name: "Queue message", exact: true })
    .click();
  await page
    .getByText("Handle this after the current task", { exact: true })
    .waitFor();
  await app.evaluate(() => globalThis.__nativeFixture.approval());
  await page.getByLabel("Export label", { exact: true }).fill("Camera-ready");
  await page.getByLabel("Include notes", { exact: true }).selectOption("false");
  await page.getByLabel("Copies", { exact: true }).fill("2");
  await page
    .locator(".ai-approval")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page.locator(".ai-approval").waitFor({ state: "detached" });
  assert.deepEqual(
    await app.evaluate(() => globalThis.__nativeFixture.answers.at(-1).content),
    { label: "Camera-ready", consent: false, count: 2 },
  );
  await app.evaluate(() => {
    globalThis.__nativeFixture.finish();
  });
  await page.getByTitle("Conversation history", { exact: true }).click();
  await page
    .getByRole("button", { name: "Fork conversation", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Project conversations" })
    .waitFor({ state: "detached" });
  assert.ok(
    (await app.evaluate(() => globalThis.__nativeFixture.actions)).includes(
      "fork",
    ),
  );
  await page.getByTitle("Agent tools and connections", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agent tools", exact: true });
  await dialog.getByLabel("Web search", { exact: true }).selectOption("live");
  await dialog.locator("summary").filter({ hasText: "Add connection" }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("papers");
  await dialog
    .getByLabel("MCP endpoint", { exact: true })
    .fill("https://papers.example.test/mcp");
  await dialog
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Sign in to papers", exact: true })
    .click();
  await dialog
    .getByText("Finish sign-in in your browser, then refresh connections.", {
      exact: true,
    })
    .waitFor();
  await dialog
    .getByRole("button", { name: "Disable papers", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Enable papers", exact: true })
    .waitFor();
  await dialog
    .getByLabel("Review target", { exact: true })
    .selectOption("baseBranch");
  await dialog.getByLabel("Review reference", { exact: true }).fill("main");
  await page.screenshot({ path: "output/playwright/ai-native-tools.png" });
  await dialog
    .getByRole("button", { name: "Start code review", exact: true })
    .click();
  await page
    .getByText("Native code review findings", { exact: true })
    .waitFor();
  requests = await app.evaluate(() => globalThis.__nativeFixture.requests);
  assert.deepEqual(requests.at(-1).reviewTarget, {
    type: "baseBranch",
    branch: "main",
  });
  assert.equal(requests.at(-1).permissionMode, "read-only");
  return "Verified steering, queue selection, failed-draft preservation, typed MCP approval, forks, web search, connection controls, and native review targets.";
});
