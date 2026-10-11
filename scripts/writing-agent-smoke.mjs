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
      emit({ type: "listening", language: "Chinese (China mainland)" });
      for (const value of [0.2, 0.9, 0.5]) emit({ type: "level", value });
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
  await page
    .getByRole("status")
    .filter({ hasText: "Listening · Chinese (China mainland)" })
    .waitFor();
  // The newest loudness is the rightmost bar of the waveform.
  assert.equal(
    await page
      .locator(".dictation-wave > i")
      .last()
      .evaluate((bar) => bar.style.height),
    "10.5px",
  );
  await page.screenshot({ path: "output/playwright/dictation-listening.png" });
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
  // Exercise the real main/renderer bridge and wait for its receipt.
  const bridge = (tool, input) =>
    app.evaluate(
      async ({ app, BrowserWindow }, { projectId, tool, input }) => {
        const requireApp = process
          .getBuiltinModule("node:module")
          .createRequire(app.getAppPath() + "/package.json");
        const { createWindowTools } = requireApp("./electron/window-tools.cjs");
        const { TOOLS } = requireApp("./electron/agent-tools.cjs");
        const { ipcMain } = requireApp("electron");
        const windowTools = createWindowTools((request) =>
          BrowserWindow.getAllWindows()[0].webContents.send(
            "agent:tool",
            request,
          ),
        );
        ipcMain.removeHandler("agent:tool-complete");
        ipcMain.handle("agent:tool-complete", (_event, id, response) =>
          windowTools.complete(id, response),
        );
        return windowTools.request(
          projectId,
          tool,
          TOOLS.find((t) => t.name === tool).parse(input),
          new AbortController().signal,
        );
      },
      { projectId: id, tool, input },
    );
  const receipt = await bridge("record_writing_items", {
    tasks: ["修改摘要", "检查引用"],
    note: "保留当前技术结论，先修改表达。",
  });
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
  const [abstract] = (await read()).tasks;
  const update = await bridge("update_project", {
    tasks: [{ id: abstract.id, status: "done", reason: "" }],
    stage: "submitted",
    milestones: [{ label: "Rebuttal", date: "2027-01-10", kind: "revision" }],
  });
  assert.deepEqual(update, {
    saved: true,
    tasks: 1,
    stage: "submitted",
    milestones: 1,
  });
  await page.getByText("Agent updated the project plan").waitFor();
  assert.equal((await read()).tasks[0].done, true);
  assert.equal((await read()).stage, "submitted");
  // The window refuses an id that is not one of the project's to-dos.
  await assert.rejects(
    bridge("update_project", {
      tasks: [{ id: "missing", status: "done", reason: "" }],
      stage: "",
      milestones: [],
    }),
    /No to-do has id missing/,
  );
  await page.screenshot({ path: "output/playwright/writing-dictation.png" });
  // The sidebar marks a project while its agent works, and a notice offers
  // to open it when the agent finishes while the user is elsewhere.
  const activity = (event) =>
    app.evaluate(
      ({ BrowserWindow }, event) =>
        BrowserWindow.getAllWindows()[0].webContents.send("ai:activity", event),
      { projectId: id, ...event },
    );
  const row = page
    .locator(".area-projects")
    .getByRole("button", { name: /Writing capture/ });
  await activity({ running: true });
  await row.and(page.locator("[aria-description='Agent working']")).waitFor();
  await page
    .locator(".main-nav")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await activity({ running: false, status: "completed", continues: false });
  await row.and(page.locator("[aria-description='Agent finished']")).waitFor();
  await page.getByText("The agent finished in Writing capture").waitFor();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByLabel("Message the AI agent", { exact: true }).waitFor();
  await row
    .and(page.locator("[aria-description]"))
    .waitFor({ state: "detached" });
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
