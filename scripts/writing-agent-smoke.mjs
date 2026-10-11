import assert from "node:assert/strict";
import { launchApp, smoke, closeApp } from "./smoke-harness.mjs";

await smoke("writing-agent", async () => {
  let { app, page } = await launchApp();
  const id = await page.evaluate(async () => {
    const state = await window.research.load();
    const project = {
      ...state.projects[0],
      name: "Writing capture",
      folder: "",
      localFolders: [],
      mainFile: "",
      tasks: [],
      notes: "Previous note",
    };
    await window.research.save({ ...state, projects: [project] });
    return project.id;
  });
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Writing capture", exact: true })
    .click();
  const input = page.getByLabel("Message the AI agent", { exact: true });
  await input.waitFor();
  // Synthetic speech events exercise the UI without turning on a microphone.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    let id;
    const emit = (event) =>
      BrowserWindow.getAllWindows()[0].webContents.send("dictation:event", {
        id,
        ...event,
      });
    for (const channel of [
      "dictation:start",
      "dictation:stop",
      "dictation:cancel",
    ])
      ipcMain.removeHandler(channel);
    ipcMain.handle("dictation:start", (_event, value) => {
      id = value;
      emit({ type: "listening" });
      emit({ type: "partial", text: "加一个待办：修改摘要" });
      return { id };
    });
    ipcMain.handle("dictation:stop", () =>
      emit({ type: "final", text: "加一个待办：修改摘要" }),
    );
    ipcMain.handle("dictation:cancel", () =>
      emit({ type: "cancelled", text: "" }),
    );
  });
  await input.fill("请帮我：旧内容。");
  await input.evaluate((node) => {
    node.focus();
    node.setSelectionRange(5, 8);
  });
  await page
    .getByRole("button", { name: "Start dictation", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "加一个待办" }).waitFor();
  assert.equal(await input.getAttribute("readonly"), "");
  await page
    .getByRole("button", { name: "Finish dictation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start dictation", exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), "请帮我：旧加一个待办：修改摘要");
  // Cancel must preserve the draft, and dictation must never send a message.
  const draft = await input.inputValue();
  await page
    .getByRole("button", { name: "Start dictation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel dictation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start dictation", exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), draft);
  assert.equal(await page.locator(".ai-user-text").count(), 0);
  // Exercise the real main/renderer save bridge and wait for its receipt.
  const receipt = await app.evaluate(
    async ({ app, BrowserWindow }, projectId) => {
      const requireApp = process
        .getBuiltinModule("node:module")
        .createRequire(app.getAppPath() + "/package.json");
      const { createWritingCapture } = requireApp("./electron/writing.cjs");
      const { ipcMain } = requireApp("electron");
      const broker = createWritingCapture((request) =>
        BrowserWindow.getAllWindows()[0].webContents.send(
          "writing:capture",
          request,
        ),
      );
      ipcMain.removeHandler("writing:complete");
      ipcMain.handle("writing:complete", (_event, id, result) =>
        broker.complete(id, result),
      );
      return broker.request(
        projectId,
        {
          tasks: ["修改摘要", "检查引用"],
          note: "保留当前技术结论，先修改表达。",
        },
        new AbortController().signal,
      );
    },
    id,
  );
  assert.equal(receipt.saved, true);
  const read = () =>
    page.evaluate(
      async (id) =>
        (await window.research.load()).projects.find((p) => p.id === id),
      id,
    );
  assert.deepEqual(
    (await read()).tasks.map((task) => task.text),
    ["修改摘要", "检查引用"],
  );
  assert.match((await read()).notes, /Previous note\n\n保留当前技术结论/);
  await page.screenshot({ path: "output/playwright/writing-dictation.png" });
  await closeApp();
  ({ app, page } = await launchApp());
  assert.deepEqual(
    (await read()).tasks.map((task) => task.text),
    ["修改摘要", "检查引用"],
  );
  assert.match((await read()).notes, /保留当前技术结论/);
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Writing capture", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Message the AI agent", { exact: true }).inputValue(),
    draft,
  );
  return "Writing UI passed: dictated selection replacement, cancel, no automatic send, project-scoped tasks/notes, and restart persistence.";
});
