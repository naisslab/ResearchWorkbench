import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  launchApp,
  closeApp,
  smoke,
  useProject,
  stubDialogs,
} from "./smoke-harness.mjs";
await smoke("continuity", async (root) => {
  const folder = path.join(root, "paper");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\section{Opening}\nFirst paragraph\n\\section{Results}\nSolar sail results\n",
  );
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 4; i++)
    doc
      .addPage([600, 800])
      .drawText(
        i === 3
          ? "Solar sail evidence: conclusive measurement"
          : `Research page ${i}`,
        { x: 50, y: 640, size: 18 },
      );
  const pdfFile = path.join(folder, "paper.pdf");
  await fs.writeFile(pdfFile, await doc.save());
  let { app, page } = await launchApp();
  const projectId = await useProject(page, "Continuity review", folder);
  await page.evaluate(async (id) => {
    const state = await window.research.load();
    state.projects = state.projects.filter((project) => project.id === id);
    await window.research.save(state);
  }, projectId);
  await page.reload();
  await page.locator(".sidebar").waitFor();
  await page.keyboard.press("Meta+k");
  await page
    .getByRole("combobox", { name: "Search workspace" })
    .fill("solar sail");
  const pdfHit = page
    .getByRole("option")
    .filter({ hasText: "paper.pdf · p. 3" });
  await pdfHit.waitFor({ timeout: 60000 });
  await pdfHit.click();
  await page
    .locator('.pdf-page[data-page-number="3"][data-rendered="true"]')
    .waitFor();
  await page.locator(".pdf-search-match").first().waitFor();
  const position = await page.evaluate(() => {
    const page = document.querySelector('.pdf-page[data-page-number="3"]');
    const scroll = document.querySelector(".pdf-scroll");
    return (
      page.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    );
  });
  assert.ok(
    position < 250 && position > -800,
    `Search should reveal page 3: ${position}`,
  );
  const text = page
    .locator('.pdf-page[data-page-number="3"] .textLayer span')
    .filter({ hasText: "Solar sail evidence" });
  await text.waitFor();
  await text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selected = getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page
    .getByRole("button", { name: "Ask Agent about selection", exact: true })
    .click();
  await page
    .locator(".ai-context-chip")
    .filter({ hasText: "paper.pdf · p. 3" })
    .waitFor();
  assert.match(
    await page.getByLabel("Message the AI agent").inputValue(),
    /PDF feedback/,
  );
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.waitForTimeout(350);
  const view = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("research-workbench.sessions")),
  );
  assert.ok(view.find(([id]) => id === projectId)[1].anchor > 0);
  await page.screenshot({
    path: "output/playwright/continuity-pdf-search.png",
  });
  await closeApp();
  ({ app, page } = await launchApp());
  await page.locator(".workbench").waitFor();
  await page
    .locator('.pdf-page[data-page-number="3"][data-rendered="true"]')
    .waitFor();
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  const destination = path.join(root, "backup");
  await fs.mkdir(destination);
  await stubDialogs(app, { open: destination });
  await page
    .getByRole("button", { name: "Create complete backup", exact: true })
    .click();
  await page.getByText(/Last backup:/).waitFor({ timeout: 60000 });
  const [backup] = await fs.readdir(destination);
  const manifest = JSON.parse(
    await fs.readFile(path.join(destination, backup, "manifest.json")),
  );
  assert.ok(manifest.files.some((file) => file.path.endsWith("paper.pdf")));
  assert.ok(
    manifest.files.some((file) => file.path.startsWith("app/pdf-annotations/")),
  );
  await page.screenshot({ path: "output/playwright/continuity-backup.png" });
  const backedUpUi = JSON.parse(
    await fs.readFile(path.join(destination, backup, "ui.json"), "utf8"),
  );
  const backedUpSessions = backedUpUi["research-workbench.sessions"];
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Continuity review", exact: true })
    .click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Home");
  await page.waitForTimeout(350);
  assert.notEqual(
    await page.evaluate(() =>
      localStorage.getItem("research-workbench.sessions"),
    ),
    backedUpSessions,
  );
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();

  const restoreFolder = path.join(root, "restored");
  await fs.mkdir(restoreFolder);
  await app.evaluate(
    ({ app, dialog }, paths) => {
      let index = 0;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths[index++]],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
      app.relaunch = () => {};
    },
    [path.join(destination, backup), restoreFolder],
  );
  const closed = app.waitForEvent("close");
  await page
    .getByRole("button", { name: "Restore backup…", exact: true })
    .click();
  await closed;
  await closeApp();
  ({ app, page } = await launchApp());
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("research-workbench.sessions"),
    ),
    backedUpSessions,
  );
  const restoredState = await page.evaluate(() => window.research.load());
  assert.notEqual(restoredState.projects[0].folder, folder);
  assert.equal(
    await fs.readFile(
      path.join(restoredState.projects[0].folder, "main.tex"),
      "utf8",
    ),
    await fs.readFile(path.join(folder, "main.tex"), "utf8"),
  );
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Continuity review", exact: true })
    .click();
  await page
    .locator('.pdf-page[data-page-number="3"][data-rendered="true"]')
    .waitFor();
  return "PDF full-text search/highlighting, page navigation, PDF selection attachment, restart restoration, complete backup and restore/restart passed.";
});
