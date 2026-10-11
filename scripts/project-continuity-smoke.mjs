import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { launchApp, closeApp, smoke, stubDialogs } from "./smoke-harness.mjs";

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("The expected persisted state did not arrive");
}
await smoke("project-continuity", async (root) => {
  const folders = [path.join(root, "one"), path.join(root, "two")];
  for (const folder of folders) {
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, "main.tex"), "Original paragraph\n");
  }
  let { app, page } = await launchApp();
  const ids = await page.evaluate(async (folders) => {
    const state = await window.research.load();
    state.projects = state.projects.slice(0, 2).map((project, index) => ({
      ...project,
      name: `Continuity ${index + 1}`,
      folder: folders[index],
      mainFile: "main.tex",
      localFolders: [],
      areaId: state.areas[0].id,
    }));
    await window.research.save(state);
    return state.projects.map((p) => p.id);
  }, folders);
  await app.evaluate(async ({ ipcMain, BrowserWindow }, ids) => {
    const state = {
      status: "connected",
      sharing: true,
      activeProfileId: "fixture",
      profiles: [
        { id: "fixture", label: "Fixture", status: "connected", sharing: true },
      ],
      models: [
        {
          slug: "test",
          displayName: "Test model",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Balanced" },
          ],
          serviceTiers: [],
        },
      ],
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        unreportedRequests: 0,
      },
      runtime: { available: true, version: "fixture" },
    };
    const chats = Object.fromEntries(
      ids.map((projectId) => [
        projectId,
        {
          projectId,
          profileId: "fixture",
          chatId: "chat",
          agentRootId: "primary",
          queue: [],
          messages: [],
        },
      ]),
    );
    globalThis.continuityFixture = chats;
    const handlers = {
      "ai:state": () => state,
      "ai:models": () => state,
      "ai:conversation": (id) => chats[id],
      "ai:skills": () => ({ skills: [], warnings: 0 }),
      "ai:send": ({ projectId }) => {
        chats[projectId].messages.push({
          id: "active-run",
          role: "assistant",
          text: "Working on this project",
          status: "running",
          createdAt: new Date().toISOString(),
          activities: [],
        });
        BrowserWindow.getAllWindows()[0].webContents.send(
          "ai:conversation",
          chats[projectId],
        );
        return chats[projectId];
      },
    };
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args) => ({
        ok: true,
        value: await handler(...args),
      }));
    }
  }, ids);
  await page.reload();
  const select = async (index) =>
    page
      .locator(".area-projects")
      .getByRole("button", { name: `Continuity ${index + 1}`, exact: true })
      .click();
  const active = () => page.locator(".project-workbench:not([hidden])");
  const mode = async (name) =>
    active()
      .getByRole("group", { name: "Workbench mode" })
      .getByRole("button", { name, exact: true })
      .click();
  await select(0);
  await mode("Source + Agent + PDF");
  await active().locator(".cm-content").fill("Unsaved project one");
  const editorHandle = await active().locator(".cm-content").elementHandle();
  await active().getByLabel("Message the AI agent").fill("Draft for one");
  await select(1);
  await mode("Source + PDF");
  await active().locator(".cm-content").fill("Saved project two");
  await page.keyboard.press("Meta+s");
  await until(
    async () =>
      (await fs.readFile(path.join(folders[1], "main.tex"), "utf8")) ===
      "Saved project two",
  );
  assert.equal(
    await fs.readFile(path.join(folders[0], "main.tex"), "utf8"),
    "Original paragraph\n",
    "Save must only target the visible project",
  );
  await select(0);
  assert.equal(
    await active().locator(".cm-content").innerText(),
    "Unsaved project one",
  );
  assert.ok(
    await editorHandle.evaluate(
      (node) => node.isConnected && !!node.getClientRects().length,
    ),
    "The same editor must survive project switches",
  );
  assert.equal(
    await active().getByLabel("Message the AI agent").inputValue(),
    "Draft for one",
  );
  await active().locator(".cm-content").click();
  await page.keyboard.press("Meta+z");
  assert.match(
    await active().locator(".cm-content").innerText(),
    /Original paragraph/,
  );
  await page.keyboard.press("Meta+Shift+z");
  assert.equal(
    await active().locator(".cm-content").innerText(),
    "Unsaved project one",
  );
  await active()
    .getByRole("button", { name: "Run AI agent", exact: true })
    .click();
  await active()
    .getByRole("button", { name: "Stop AI agent", exact: true })
    .waitFor();
  await active()
    .getByLabel("Message the AI agent")
    .fill("Next instruction for one");
  await select(1);
  await mode("Source + Agent + PDF");
  await active().getByLabel("Message the AI agent").fill("Draft for two");
  // Deliver a real IPC completion while its workbench is hidden.
  await app.evaluate(({ BrowserWindow }, id) => {
    const chat = globalThis.continuityFixture[id];
    chat.messages[0].text = "Finished in the background";
    chat.messages[0].status = "completed";
    BrowserWindow.getAllWindows()[0].webContents.send("ai:conversation", chat);
  }, ids[0]);
  await select(0);
  await active()
    .getByText("Finished in the background", { exact: true })
    .waitFor();
  assert.equal(
    await active().getByLabel("Message the AI agent").inputValue(),
    "Next instruction for one",
  );
  await active()
    .locator('.cm-content[contenteditable="true"]')
    .fill("Recover after crash");
  await until(() =>
    page.evaluate(
      async (id) =>
        (await window.research.readDraft(id, "main.tex", "primary"))?.text ===
        "Recover after crash",
      ids[0],
    ),
  );
  // Changing the attached directory must preserve the old directory's draft.
  await page
    .locator(".crumb-switch")
    .getByRole("button", { name: "Details", exact: true })
    .click();
  await stubDialogs(app, { open: folders[1] });
  await page.locator("button").filter({ hasText: "Change folder" }).click();
  await until(() =>
    page
      .evaluate(
        async (id) =>
          (await window.research.load()).projects.find((p) => p.id === id)
            .folder,
        ids[0],
      )
      .then((folder) => folder === folders[1]),
  );
  await page
    .locator(".crumb-switch")
    .getByRole("button", { name: "Workbench", exact: true })
    .click();
  await until(
    async () =>
      (await active().locator(".cm-content").innerText()) ===
      "Saved project two",
  );
  // Wait for the clean buffer's flush to exercise deletion of only its own copy.
  await page.evaluate(async () => {
    const pending = [];
    window.dispatchEvent(
      new CustomEvent("research:flush-drafts", { detail: pending }),
    );
    await Promise.all(pending);
  });
  await page
    .locator(".crumb-switch")
    .getByRole("button", { name: "Details", exact: true })
    .click();
  await stubDialogs(app, { open: folders[0] });
  await page.locator("button").filter({ hasText: "Change folder" }).click();
  await until(() =>
    page
      .evaluate(
        async (id) =>
          (await window.research.load()).projects.find((p) => p.id === id)
            .folder,
        ids[0],
      )
      .then((folder) => folder === folders[0]),
  );
  await page
    .locator(".crumb-switch")
    .getByRole("button", { name: "Workbench", exact: true })
    .click();
  await until(
    async () =>
      (await active().locator(".cm-content").innerText()) ===
      "Recover after crash",
  );
  await page.screenshot({ path: "output/playwright/project-continuity.png" });
  await closeApp();
  await fs.writeFile(
    path.join(folders[0], "main.tex"),
    "External edit while closed",
  );
  ({ app, page } = await launchApp());
  await active()
    .getByText("Recovered unsaved draft. Review it, then save with ⌘S.")
    .waitFor();
  assert.equal(
    await active().locator(".cm-content").innerText(),
    "Recover after crash",
  );
  await active().locator(".cm-content").click();
  await page.keyboard.press("Meta+s");
  await page
    .getByText(
      "Resolve the disk conflict with Reload or Keep mine before saving.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await fs.readFile(path.join(folders[0], "main.tex"), "utf8"),
    "External edit while closed",
  );
  await active().getByRole("button", { name: "Reload", exact: true }).click();
  await until(() =>
    page.evaluate(
      async (id) =>
        !(await window.research.readDraft(id, "main.tex", "primary")),
      ids[0],
    ),
  );
  assert.equal(
    await active().locator(".cm-content").innerText(),
    "External edit while closed",
  );
  assert.equal(
    await fs.readFile(path.join(folders[0], "main.tex"), "utf8"),
    "External edit while closed",
  );
  await closeApp();
  const draftDirectory = path.join(root, "user-data", "editor-drafts");
  const draftFile = path.join(
    draftDirectory,
    createHash("sha256")
      .update(JSON.stringify([ids[0], "primary", "main.tex"]))
      .digest("hex") + ".json",
  );
  await fs.mkdir(draftDirectory, { recursive: true });
  await fs.writeFile(draftFile, "damaged recovery record");
  ({ app, page } = await launchApp());
  await active()
    .getByRole("button", { name: "Retry recovery", exact: true })
    .waitFor();
  await select(1);
  await select(0);
  assert.equal(
    await fs.readFile(draftFile, "utf8"),
    "damaged recovery record",
    "Unreadable recovery copies must survive automatic flushes",
  );
  return "Project continuity: buffers, undo, per-project layout, isolated save, Agent background completion, drafts and crash/conflict recovery passed.";
});
