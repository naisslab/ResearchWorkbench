import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { launchApp, closeApp, resizeWindow, smoke } from "./smoke-harness.mjs";

async function fixture(app, root) {
  await app.evaluate(
    async ({ app, ipcMain, BrowserWindow }, { root, repo }) => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json");
      const crypto = require("node:crypto");
      const fs = require("node:fs/promises");
      const path = require("node:path");
      const { WORKSPACE_AGENT_ID, WORKSPACE_TOOLS, fields } = require(
        path.join(repo, "electron/workspace-tools.cjs"),
      );
      const { createWindowTools } = require(
        path.join(repo, "electron/window-tools.cjs"),
      );
      const file = path.join(root, "workspace-agent-fixture.json");
      let conversation = await fs
        .readFile(file, "utf8")
        .then(JSON.parse, () => ({
          projectId: WORKSPACE_AGENT_ID,
          profileId: "fixture",
          chatId: "workspace-chat",
          messages: [],
          queue: [],
        }));
      const ok = (value) => ({ ok: true, value });
      const emit = () =>
        BrowserWindow.getAllWindows()[0].webContents.send(
          "ai:conversation",
          conversation,
        );
      const windowTools = createWindowTools((request) =>
        BrowserWindow.getAllWindows()[0].webContents.send(
          "agent:tool",
          request,
        ),
      );
      const model = {
        slug: "fixture",
        displayName: "Test model",
        supportedReasoningEfforts: [],
        serviceTiers: [],
      };
      const state = {
        status: "connected",
        sharing: true,
        activeProfileId: "fixture",
        profiles: [
          {
            id: "fixture",
            label: "Fixture",
            status: "connected",
            sharing: true,
          },
        ],
        models: [model],
        runtime: { available: true },
        usage: {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          unreportedRequests: 0,
        },
      };
      globalThis.workspaceFixture = {
        requests: [],
        results: [],
        disconnect: () => {
          state.sharing = false;
          state.status = "disconnected";
        },
        removeProject: (id) =>
          windowTools.request(
            WORKSPACE_AGENT_ID,
            "manage_workspace",
            WORKSPACE_TOOLS.find(
              (tool) => tool.name === "manage_workspace",
            ).parse({
              operations: [
                {
                  entity: "project",
                  action: "remove",
                  id,
                  projectId: "",
                  changes: Object.fromEntries(
                    Object.keys(fields.project).map((key) => [key, null]),
                  ),
                },
              ],
            }),
            new AbortController().signal,
          ),
      };
      const op = (entity, changes, projectId = "") => ({
        entity,
        action: "create",
        id: "",
        projectId,
        changes: {
          ...Object.fromEntries(
            Object.keys(fields[entity]).map((key) => [key, null]),
          ),
          ...changes,
        },
      });
      const handlers = {
        "ai:state": () => ok(state),
        "ai:models": () => ok(state),
        "ai:skills": () => ok({ skills: [], warnings: 0 }),
        "ai:conversation": (_event, id) =>
          ok(
            id === WORKSPACE_AGENT_ID
              ? conversation
              : {
                  projectId: id,
                  profileId: "fixture",
                  chatId: "project-chat",
                  messages: [],
                },
          ),
        "ai:chats": () =>
          ok([
            {
              id: conversation.chatId,
              title: "Workspace chat",
              active: true,
              archived: false,
            },
          ]),
        "agent:tool-complete": (_event, id, response) =>
          windowTools.complete(id, response),
        "ai:send": async (_event, request) => {
          globalThis.workspaceFixture.requests.push(request);
          const assistant = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "",
            status: "running",
            createdAt: new Date().toISOString(),
            activities: [],
          };
          conversation.messages.push(
            {
              id: crypto.randomUUID(),
              role: "user",
              text: request.message,
              status: "completed",
              createdAt: new Date().toISOString(),
            },
            assistant,
          );
          emit();
          const run = async () => {
            try {
              const tool = WORKSPACE_TOOLS.find(
                (t) => t.name === "manage_workspace",
              );
              const input = tool.parse({
                operations: [
                  op(
                    "task",
                    { text: `Review ${request.workspaceContextProjectId}` },
                    request.workspaceContextProjectId,
                  ),
                  op("deadline", {
                    label: `Deadline ${request.workspaceContextProjectId}`,
                    time: "2026-11-03T10:00:00Z",
                    timezone: "Asia/Hong_Kong",
                    projectIds: [request.workspaceContextProjectId],
                  }),
                ],
              });
              const result = await windowTools.request(
                WORKSPACE_AGENT_ID,
                "manage_workspace",
                input,
                new AbortController().signal,
              );
              globalThis.workspaceFixture.results.push(result);
              assistant.text = `Saved a to-do and a deadline for ${request.workspaceContextProjectId}.\n\n[Open project notes](workspace/${request.workspaceContextProjectId}?kind=file&file=notes.txt&rootId=primary&line=1)`;
              assistant.status = "completed";
            } catch (error) {
              assistant.status = "failed";
              assistant.text = error.message;
            }
            await fs.writeFile(file, JSON.stringify(conversation));
            emit();
          };
          if (request.message.includes("background")) setTimeout(run, 500);
          else await run();
          return ok(conversation);
        },
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      }
    },
    { root, repo: process.cwd() },
  );
}
await smoke("workspace-agent", async (root) => {
  let { app, page } = await launchApp();
  page.setDefaultTimeout(20000);
  const folder = path.join(root, "paper");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "notes.txt"),
    "Workspace bar search evidence\n",
  );
  const pdf = await PDFDocument.create();
  pdf
    .addPage([600, 800])
    .drawText("Workspace bar search evidence from the manuscript", {
      x: 50,
      y: 640,
      size: 16,
    });
  await fs.writeFile(path.join(folder, "manuscript.pdf"), await pdf.save());
  const ids = await page.evaluate(async (folder) => {
    const state = await window.research.load();
    state.projects = state.projects.slice(0, 2).map((p, i) => ({
      ...p,
      id: `bar-${i + 1}`,
      name: `Bar project ${i + 1}`,
      notes: "Workspace bar search evidence in project notes",
      folder,
      mainFile: "",
      localFolders: [],
      tasks: [],
      deadlines: [],
    }));
    state.trackedDeadlines = [];
    await window.research.save(state);
    return state.projects.map((p) => p.id);
  }, folder);
  await fixture(app, root);
  await page.reload();
  const select = async (index) =>
    page
      .locator(".area-projects")
      .getByRole("button", { name: `Bar project ${index + 1}`, exact: true })
      .click();
  const open = async () => {
    await page
      .getByRole("button", { name: "Open workspace agent", exact: true })
      .click();
    await page.getByRole("region", { name: "Workspace AI agent" }).waitFor();
  };
  const modal = () =>
    page.getByRole("dialog", { name: "Workspace", exact: true });
  const composer = () =>
    modal().getByLabel("Search or ask your workspace", { exact: true });
  const send = async (message) => {
    await composer().fill(message);
    await modal()
      .getByRole("button", { name: "Run AI agent", exact: true })
      .click();
  };
  await select(0);
  await open();
  await modal()
    .getByText("Current project: Bar project 1", { exact: true })
    .waitFor();
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/workspace-unified-empty.png",
  });
  // Full search is visible from the empty workspace and reuses its only input.
  await modal()
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await modal()
    .getByText(
      "Search file contents, PDF text, notes, and conversations. Your projects are below.",
    )
    .waitFor();
  assert.equal(await modal().getByRole("option").count(), 2);
  assert.equal(
    await composer().evaluate(
      (node) => node.scrollHeight > node.clientHeight + 1,
    ),
    false,
    "An empty search input must not show a scrollbar",
  );
  await composer().fill("Workspace bar search evidence");
  await modal()
    .getByRole("option")
    .filter({ hasText: "manuscript.pdf" })
    .first()
    .waitFor();
  await modal().locator('.search-results[aria-busy="false"]').waitFor();
  assert.equal(await modal().getByRole("option").count(), 6);
  assert.ok((await modal().locator(".search-snippet mark").count()) > 0);
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/workspace-search-light.png",
  });
  await modal()
    .getByRole("button", { name: "This project", exact: true })
    .click();
  assert.equal(await modal().getByRole("option").count(), 3);
  const filters = modal().getByRole("group", { name: "Search result type" });
  for (const [name, title] of [
    [/^Files/, "notes.txt"],
    [/^PDFs/, "manuscript.pdf"],
    [/^Projects & notes/, "Bar project 1"],
  ]) {
    await filters.getByRole("button", { name }).click();
    assert.equal(await modal().getByRole("option").count(), 1);
    assert.match(
      await modal().getByRole("option").innerText(),
      new RegExp(title.replace(".", "\\.")),
    );
  }
  await filters.getByRole("button", { name: /^Chats/ }).click();
  await modal().getByText("No results found", { exact: true }).waitFor();
  await composer().press("Enter");
  await composer().press("Meta+Enter");
  assert.equal(
    await app.evaluate(() => globalThis.workspaceFixture.requests.length),
    0,
    "Empty search must never submit an agent request",
  );
  await modal()
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  assert.equal(await modal().getByRole("option").count(), 6);
  await modal()
    .getByRole("button", { name: "Back to conversation", exact: true })
    .click();
  assert.equal(await composer().inputValue(), "Workspace bar search evidence");
  assert.equal(
    await modal().getByRole("option").count(),
    4,
    "Quick matches remain compact",
  );
  await composer().fill("Workspace bar search evidence");
  await modal()
    .getByRole("option")
    .filter({ hasText: "notes.txt" })
    .first()
    .waitFor();
  await composer().press("Enter");
  await modal()
    .getByText("Saved a to-do and a deadline for bar-1.", { exact: true })
    .waitFor();
  let state = await page.evaluate(() => window.research.load());
  assert.equal(state.projects[0].tasks.length, 1);
  assert.equal(state.projects[1].tasks.length, 0);
  assert.equal(state.trackedDeadlines.length, 1);
  // Undo goes through the same save pipeline and removes the whole batch.
  await modal().getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(
    async () => !(await window.research.load()).trackedDeadlines.length,
  );
  // Ask deliberately sends the same query to the agent from full search.
  await modal()
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await send("Add them again");
  await page.waitForFunction(
    async () => (await window.research.load()).trackedDeadlines.length === 1,
  );
  await composer().fill("Draft survives closing");
  await modal().getByRole("button", { name: "Close", exact: true }).click();
  await select(1);
  await open();
  assert.equal(await composer().inputValue(), "Draft survives closing");
  await modal()
    .getByText("Current project: Bar project 2", { exact: true })
    .waitFor();
  await send("Add in the background");
  await modal().getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForFunction(
    async () => (await window.research.load()).projects[1].tasks.length === 1,
  );
  await open();
  await modal()
    .getByText("Saved a to-do and a deadline for bar-2.", { exact: true })
    .waitFor();
  await composer().fill("Draft survives restart");
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/workspace-agent.png",
  });
  assert.equal(
    await modal().getByRole("tab").count(),
    0,
    "Search and agent share one surface",
  );
  assert.equal(
    await modal()
      .locator("textarea:visible, input:not([type=hidden]):visible")
      .count(),
    1,
  );
  await composer().fill("Workspace bar search evidence");
  const hit = modal()
    .getByRole("option")
    .filter({ hasText: "notes.txt" })
    .first();
  await hit.waitFor();
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/workspace-unified-search.png",
  });
  const requestsBefore = await app.evaluate(
    () => globalThis.workspaceFixture.requests.length,
  );
  await composer().dispatchEvent("compositionstart");
  await composer().dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await composer().dispatchEvent("compositionend");
  assert.equal(
    await app.evaluate(() => globalThis.workspaceFixture.requests.length),
    requestsBefore,
    "IME Enter must not submit",
  );
  await composer().press("ArrowDown");
  await modal().getByRole("option", { selected: true }).waitFor();
  await composer().press("Enter");
  await modal().waitFor({ state: "detached" });
  assert.equal(
    await app.evaluate(() => globalThis.workspaceFixture.requests.length),
    requestsBefore,
    "Opening search results must not call the agent",
  );
  await open();
  assert.equal(
    await composer().inputValue(),
    "Workspace bar search evidence",
    "Search navigation preserves the shared draft",
  );
  await composer().fill("Draft survives restart");
  await closeApp();
  ({ app, page } = await launchApp());
  page.setDefaultTimeout(20000);
  await fixture(app, root);
  await page.reload();
  await open();
  assert.equal(await composer().inputValue(), "Draft survives restart");
  await modal()
    .getByText("Saved a to-do and a deadline for bar-2.", { exact: true })
    .waitFor();
  state = await page.evaluate(() => window.research.load());
  assert.deepEqual(
    state.projects.map((p) => p.tasks.length),
    [1, 1],
  );
  assert.deepEqual(
    state.trackedDeadlines.map((d) => d.projectIds[0]),
    ids,
  );
  // Opening commands temporarily uses the same input without erasing the chat draft.
  await modal().getByRole("button", { name: "Close", exact: true }).click();
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      .items.find((item) => item.label === "File")
      .submenu.items.find((item) => item.label === "Command Palette…")
      .click();
  });
  await composer().waitFor();
  assert.equal(await composer().inputValue(), ">");
  await composer().fill(">overview");
  await modal()
    .getByRole("option", { name: /Overview/ })
    .waitFor();
  await composer().press("Enter");
  await modal().waitFor({ state: "detached" });
  await page
    .getByRole("heading", { name: "Research Overview", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await open();
  // The modal mounts before its chat and saved draft finish loading.
  await page.waitForFunction(
    () =>
      document.querySelector(".workspace-agent-modal textarea")?.value ===
      "Draft survives restart",
  );
  assert.equal(
    await composer().inputValue(),
    "Draft survives restart",
    "Command search must preserve the chat draft",
  );
  await resizeWindow(app, page, 1050, 700);
  const overflow = await modal().evaluate(
    (node) => node.scrollWidth > node.clientWidth + 2,
  );
  assert.equal(overflow, false, "Agent bar must fit a narrow window");
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/workspace-agent-narrow.png",
  });
  await composer().fill("Workspace bar search evidence");
  await modal()
    .getByRole("button", { name: "Browse results", exact: true })
    .click();
  await modal()
    .getByRole("option")
    .filter({ hasText: "manuscript.pdf" })
    .first()
    .waitFor();
  await modal().locator('.search-results[aria-busy="false"]').waitFor();
  const bounds = await modal().evaluate((node) => {
    const modal = node.getBoundingClientRect();
    return [
      ...node.querySelectorAll(
        ".ai-composer, .workspace-search-filters, .workspace-search-footer, .ai-toolbar",
      ),
    ].every((child) => {
      const box = child.getBoundingClientRect();
      return (
        box.top >= modal.top &&
        box.bottom <= modal.bottom &&
        box.left >= modal.left &&
        box.right <= modal.right
      );
    });
  });
  assert.equal(
    bounds,
    true,
    "Search controls must fit the minimum supported window",
  );
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/workspace-search-dark.png",
  });
  assert.equal(
    await modal().evaluate((node) => node.scrollWidth > node.clientWidth + 2),
    false,
  );
  await composer().press("Escape");
  await modal()
    .getByRole("button", { name: "Browse results", exact: true })
    .waitFor();
  await modal()
    .getByRole("link", { name: "Open project notes", exact: true })
    .last()
    .click();
  await modal().waitFor({ state: "detached" });
  await page
    .locator(".project-workbench:not([hidden]) .cm-activeLine")
    .filter({ hasText: "Workspace bar search evidence" })
    .waitFor();
  await app.evaluate(
    async (_electron, id) => globalThis.workspaceFixture.removeProject(id),
    ids[1],
  );
  await page
    .getByRole("heading", { name: "Research Overview", exact: true })
    .waitFor();
  assert.equal(
    await fs.readFile(path.join(folder, "notes.txt"), "utf8"),
    "Workspace bar search evidence\n",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(
    async () => (await window.research.load()).projects.length === 2,
  );
  // Local search remains available without a model connection, including after reload.
  await app.evaluate(() => globalThis.workspaceFixture.disconnect());
  await page.reload();
  await open();
  await modal()
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await composer().fill("Workspace bar search evidence");
  await modal()
    .getByRole("group", { name: "Search result type" })
    .getByRole("button", { name: /^Files/ })
    .click();
  await modal()
    .getByRole("option")
    .filter({ hasText: "notes.txt" })
    .first()
    .waitFor();
  assert.equal(
    await modal()
      .getByRole("button", { name: "Run AI agent", exact: true })
      .isDisabled(),
    true,
  );
  const disconnectedRequests = await app.evaluate(
    () => globalThis.workspaceFixture.requests.length,
  );
  await composer().press("Enter");
  await modal().waitFor({ state: "detached" });
  assert.equal(
    await app.evaluate(() => globalThis.workspaceFixture.requests.length),
    disconnectedRequests,
  );
  // Model an IPC progress packet arriving after the final query response.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler("search:query");
    ipcMain.handle("search:query", (_event, _query, id) => {
      const results = [1, 2].map((index) => ({
        id: `late-${index}`,
        projectId: "bar-1",
        projectName: "Bar project 1",
        kind: "file",
        title: `Complete result ${index}`,
        snippet: "late progress fixture",
      }));
      globalThis.workspaceFixture.emitLateProgress = () =>
        BrowserWindow.getAllWindows()[0].webContents.send("search:progress", {
          id,
          results: results.slice(0, 1),
          warnings: [],
          scanned: 9,
          partial: true,
        });
      return { results, warnings: [], scanned: 10 };
    });
  });
  await open();
  await modal()
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await composer().fill("late progress fixture");
  await modal()
    .getByRole("option")
    .filter({ hasText: "Complete result 2" })
    .waitFor();
  await page.evaluate(() =>
    window.research.onSearchProgress((value) => {
      window.searchProgressObserved = value.scanned;
    }),
  );
  await app.evaluate(() => globalThis.workspaceFixture.emitLateProgress());
  await page.waitForFunction(() => window.searchProgressObserved === 9);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await modal().getByRole("option").count(),
    2,
    "Late progress must not overwrite completed search results",
  );
  return "Workspace agent UI passed: full search, type and project filters, disconnected search, explicit Ask, empty search without model calls, light/dark and narrow layouts, current-project context, batch saves, Undo, project removal/navigation, background completion, workspace search, clickable answer sources, draft preservation, project switches and application restart.";
});
