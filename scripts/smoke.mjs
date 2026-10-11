import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  closeApp,
  dragDivider,
  launchApp,
  resizeWindow,
  smoke,
  stubDialogs,
} from "./smoke-harness.mjs";
await smoke("ui", async (root) => {
  let { app, page } = await launchApp();
  await page.screenshot({ path: "output/playwright/overview.png" });
  assert.equal(await page.locator(".project-card").count(), 25);
  assert.equal(
    await page
      .locator(".area-projects button:not(.add-project-inline)")
      .count(),
    25,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Adaptive Inference", exact: true })
      .count(),
    0,
  );
  const sidebarDivider = page.getByRole("separator", {
    name: "Resize research sidebar",
    exact: true,
  });
  const initialSidebar = (await page.locator(".sidebar").boundingBox()).width;
  const draggedSidebar = await dragDivider(page, "Resize research sidebar", 48);
  assert.ok(
    draggedSidebar > initialSidebar + 40,
    `Sidebar drag should add 48px: started at ${initialSidebar}, ended at ${draggedSidebar}`,
  );
  await sidebarDivider.dblclick();
  assert.equal((await page.locator(".sidebar").boundingBox()).width, 248);
  await sidebarDivider.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal((await page.locator(".sidebar").boundingBox()).width, 238);
  await page.keyboard.press("Shift+ArrowRight");
  assert.equal((await page.locator(".sidebar").boundingBox()).width, 288);
  await sidebarDivider.dblclick();
  const initial = await page.evaluate(() => window.research.load());
  assert.equal(
    initial.projects.some((p) => p.example),
    false,
  );
  for (const [id, count] of [
    ["ml", 14],
    ["security", 8],
    ["cps", 3],
  ])
    assert.equal(initial.projects.filter((p) => p.areaId === id).length, count);
  await page
    .getByRole("button", { name: "Project board", exact: true })
    .first()
    .click();
  assert.equal(await page.locator(".board-card").count(), 25);
  assert.deepEqual(await page.locator(".board-heading h3").allTextContents(), [
    "Idea Exploration",
    "Experiments",
    "Paper Writing",
    "Submitted",
    "Revision",
    "Accepted",
    "Published",
  ]);
  const mlNames = await page
    .locator(".area-group")
    .first()
    .locator(".area-projects button:not(.add-project-inline)")
    .allTextContents();
  assert.equal(
    initial.projects.find((p) => p.name === mlNames[0]).stage,
    "writing",
  );
  assert.equal(mlNames.at(-1), "FlowWise");
  await page.getByLabel("Stage for PACC").selectOption("revision");
  await page
    .getByRole("button", { name: "Security and Privacy", exact: true })
    .first()
    .click();
  assert.equal(await page.locator(".board-card").count(), 8);
  await page
    .getByRole("heading", { name: "Project Board", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Overview", exact: false }).click();
  await resizeWindow(app, page, 1100, 780);
  await page.screenshot({ path: "output/playwright/overview-compact.png" });
  await resizeWindow(app, page, 1510, 980);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("UI Integration Project");
  await page
    .getByLabel("Research question or short description")
    .fill("A project created through the real desktop UI.");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "UI Integration Project", exact: true })
    .waitFor();
  await page.getByLabel("Add a next step").fill("Run the end-to-end workflow");
  await page
    .locator(".task-add")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page
    .locator(".details-aside .button.full-width")
    .filter({ hasText: "Add milestone" })
    .click();
  await page.getByLabel("Milestone name").fill("Test submission");
  await page.getByLabel("Date", { exact: true }).fill("2099-11-15");
  await page.getByLabel("Source link").fill("https://example.com/cfp");
  await page
    .locator(".modal")
    .getByRole("button", { name: "Add milestone", exact: true })
    .click();
  await page.getByText("Test submission", { exact: true }).waitFor();
  await page.screenshot({ path: "output/playwright/project-details.png" });
  const manuscriptFolder = path.join(root, "test-manuscript");
  await fs.mkdir(manuscriptFolder);
  await fs.writeFile(
    path.join(manuscriptFolder, "main.tex"),
    String.raw`\documentclass{article}
\begin{document}
\section{UI Integration Project}
This manuscript exists only in the automated test workspace.
\end{document}
`,
  );
  await stubDialogs(app, { open: manuscriptFolder });
  await page
    .locator(".details-aside .button.full-width")
    .filter({ hasText: "Attach folder" })
    .click();
  await page.getByRole("button", { name: "Open workbench" }).click();
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await page.locator(".cm-content").waitFor();
  assert.ok(
    (await page.locator(".cm-content").innerText()).includes(
      "UI Integration Project",
    ),
  );
  // Attach a separate source folder and edit a nested file through the tree.
  const codeFolder = path.join(root, "test-code");
  await fs.mkdir(path.join(codeFolder, "src"), { recursive: true });
  await fs.writeFile(
    path.join(codeFolder, "src", "train.py"),
    "print('before')\n",
  );
  await stubDialogs(app, { open: codeFolder });
  await page
    .getByRole("button", { name: "Add local folder", exact: true })
    .click();
  await page.getByLabel("Folder label").fill("Code");
  await page
    .getByRole("button", { name: "Choose local folder", exact: true })
    .click();
  await page
    .locator(".file-root-heading strong")
    .filter({ hasText: /^Code$/ })
    .waitFor();
  await page.getByRole("button", { name: "src", exact: true }).click();
  await page.getByRole("button", { name: "train.py", exact: true }).click();
  await page.locator(".cm-content").fill("print('saved with Ctrl S')");
  await page.keyboard.press("Control+s");
  await page
    .locator(".editor-status")
    .getByText("Unsaved changes", { exact: true })
    .waitFor({ state: "hidden" });
  assert.match(
    await fs.readFile(path.join(codeFolder, "src", "train.py"), "utf8"),
    /saved with Ctrl S/,
  );
  await page.locator(".cm-content").fill("print('saved with Command S')");
  await page.keyboard.press("Meta+s");
  await page
    .locator(".editor-status")
    .getByText("Unsaved changes", { exact: true })
    .waitFor({ state: "hidden" });
  assert.match(
    await fs.readFile(path.join(codeFolder, "src", "train.py"), "utf8"),
    /saved with Command S/,
  );
  // The tree's menu renames the open file, then trashes it into the test root
  // rather than the user's Trash.
  const trashed = path.join(root, "trashed.py");
  await app.evaluate(({ shell }, trashed) => {
    shell.trashItem = (file) =>
      process.getBuiltinModule("node:fs/promises").rename(file, trashed);
  }, trashed);
  await page
    .getByRole("button", { name: "train.py", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByLabel("Filename").fill("src/model.py");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("button", { name: "model.py", exact: true })
    .click({ button: "right" });
  assert.equal(
    await page.getByRole("button", { name: "train.py", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.locator(".editor-file-tab").innerText(),
    "src/model.py",
  );
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page
    .getByRole("button", { name: "model.py", exact: true })
    .waitFor({ state: "detached" });
  assert.match(await fs.readFile(trashed, "utf8"), /saved with Command S/);
  await page.getByLabel("Find project files").fill("main.tex");
  await page
    .getByRole("button", { name: "main.tex entry", exact: true })
    .click();
  await page.getByLabel("Find project files").fill("");
  await page.getByRole("button", { name: "Dates & deadlines" }).click();
  await page
    .getByRole("heading", { name: "Dates & Deadlines", exact: true })
    .waitFor();
  await page
    .getByRole("tab", { name: "Project milestones", exact: true })
    .click();
  assert.equal(
    await page
      .locator(".deadline-table-row")
      .filter({ hasText: "UI Integration Project" })
      .count(),
    1,
  );
  await page
    .locator(".main-nav")
    .getByRole("button", { name: "Project board", exact: true })
    .click();
  await page.screenshot({ path: "output/playwright/project-board.png" });
  await page
    .getByLabel("Stage for UI Integration Project")
    .selectOption("writing");
  await page
    .getByRole("button", { name: "UI Integration Project", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await page.locator(".cm-content").waitFor();
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await page
    .getByText("Connected", { exact: true })
    .waitFor({ timeout: 10000 });
  const terminalOutput = await page.evaluate(async () => {
    const state = await window.research.load();
    const key = `${state.projects.find((p) => p.name === "UI Integration Project").id}:local`;
    return new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => {
        off();
        reject(new Error("Terminal output timed out"));
      }, 8000);
      const off = window.research.onTerminalData((data) => {
        if (data.key === key) {
          output += data.text;
          if (output.includes("RESEARCH_PTY_OK")) {
            clearTimeout(timer);
            off();
            resolve(output);
          }
        }
      });
      window.research.writeTerminal(key, 'printf "RESEARCH_PTY_OK\\n"\r');
    });
  });
  assert.match(terminalOutput, /RESEARCH_PTY_OK/);
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page
    .getByText("Build succeeded · PDF updated", { exact: false })
    .waitFor({ timeout: 30000 });
  const pdfUrl = await page.locator(".pdf-reader").getAttribute("data-pdf-url");
  const magic = await page.evaluate(async (url) => {
    const { projects } = await window.research.load();
    const id = projects.find((p) => p.name === "UI Integration Project").id;
    const { data } = await window.research.readPdfAnnotations(id, url);
    return String.fromCharCode(...new Uint8Array(data.slice(0, 5)));
  }, pdfUrl);
  assert.equal(magic, "%PDF-");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "output/playwright/workbench.png" });
  // Split panes resize by dragging even across the embedded PDF surface.
  const filesDivider = page.getByRole("separator", {
    name: "Resize project files",
    exact: true,
  });
  assert.equal(Number(await filesDivider.getAttribute("aria-valuenow")), 220);
  assert.equal(await dragDivider(page, "Resize project files", 56), 276);
  await filesDivider.dblclick();
  assert.equal(Number(await filesDivider.getAttribute("aria-valuenow")), 220);
  const beforePdf = (await page.locator(".pdf-pane").boundingBox()).width;
  await dragDivider(page, "Resize editor and PDF", 100);
  assert.ok(
    (await page.locator(".pdf-pane").boundingBox()).width < beforePdf - 90,
  );
  await dragDivider(page, "Resize terminal panel", 0, -60);
  assert.equal(
    Math.round((await page.locator(".bottom-panel").boundingBox()).height),
    270,
  );
  // Esc cancels a live drag and restores the previous width.
  const box = await filesDivider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(Number(await filesDivider.getAttribute("aria-valuenow")), 220);
  await page.getByTitle("Expand PDF preview").click();
  assert.equal(await filesDivider.count(), 0);
  assert.equal(await page.locator(".editor-pane:visible").count(), 0);
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  assert.equal(await page.locator(".editor-pane:visible").count(), 1);
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await page.getByTitle("Reset panel layout").click();
  assert.equal(
    Math.round((await page.locator(".bottom-panel").boundingBox()).height),
    210,
  );
  await dragDivider(page, "Resize research sidebar", 56);
  await dragDivider(page, "Resize project files", 40);
  await dragDivider(page, "Resize editor and PDF", -55);
  await dragDivider(page, "Resize terminal panel", 0, -45);
  await resizeWindow(app, page, 1050, 760);
  const narrow = await page.evaluate(() => {
    const boxes = [
      ".sidebar",
      ".file-sidebar",
      ".editor-pane",
      ".pdf-pane",
    ].map((selector) =>
      document.querySelector(selector).getBoundingClientRect(),
    );
    return {
      boxes: boxes.map((box) => ({ width: box.width, right: box.right })),
      viewport: window.innerWidth,
    };
  });
  assert.ok(
    narrow.boxes[2].width >= 240 && narrow.boxes[3].width >= 260,
    JSON.stringify(narrow),
  );
  assert.ok(narrow.boxes[3].right <= narrow.viewport + 1);
  // PDF pages repaint asynchronously after their viewport resizes.
  await page.waitForTimeout(800);
  await page.screenshot({ path: "output/playwright/workbench-compact.png" });
  await resizeWindow(app, page, 1510, 980);
  await page.waitForTimeout(800);
  await page.screenshot({ path: "output/playwright/workbench-resized.png" });
  const original = await page.locator(".cm-content").innerText();
  await page
    .locator(".cm-content")
    .fill(
      "\\documentclass{article}\n\\begin{document}\n\\UndefinedSmokeCommand\n\\end{document}",
    );
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page
    .getByText("Build failed", { exact: false })
    .waitFor({ timeout: 30000 });
  assert.ok(
    (await page.locator(".build-panel pre").innerText()).includes(
      "Undefined control sequence",
    ),
  );
  // The Build log hands a fix request to the agent; the user sends it.
  await page
    .getByRole("button", { name: "Ask Agent to fix", exact: true })
    .click();
  assert.match(
    await page.getByLabel("Message the AI agent", { exact: true }).inputValue(),
    /^Fix the problems listed in the Build log/,
  );
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: /Build log/ })
    .click();
  await page.getByLabel("Compile on save").check();
  await page.locator(".cm-content").fill(original);
  await page.getByRole("button", { name: /^Save/ }).click();
  await page
    .getByText("Build succeeded · PDF updated")
    .waitFor({ timeout: 30000 });
  const savedLayout = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("research-workbench.panels.v1")),
  );
  await closeApp();
  ({ app, page } = await launchApp());
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("research-workbench.panels.v1")),
    ),
    savedLayout,
  );
  assert.equal(
    Math.round((await page.locator(".sidebar").boundingBox()).width),
    Math.round(savedLayout.sidebar),
  );
  await page
    .locator(".main-nav")
    .getByRole("button", { name: "Project board", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Stage for UI Integration Project").inputValue(),
    "writing",
  );
  await page.getByRole("button", { name: "Dates & deadlines" }).click();
  await page
    .getByRole("tab", { name: "Project milestones", exact: true })
    .click();
  assert.equal(
    await page
      .locator(".deadline-table-row")
      .filter({ hasText: "UI Integration Project" })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "UI Integration Project", exact: true })
    .click();
  await page.locator('.pdf-page[data-rendered="true"]').first().waitFor();
  assert.equal(
    Math.round((await page.locator(".file-sidebar").boundingBox()).width),
    Math.round(savedLayout.files),
  );
  assert.equal(
    Math.round((await page.locator(".bottom-panel").boundingBox()).height),
    Math.round(savedLayout.terminal),
  );
  const integration = (
    await page.evaluate(() => window.research.load())
  ).projects.find((p) => p.name === "UI Integration Project");
  assert.equal(integration.localFolders[0].label, "Code");
  assert.equal(integration.compileOnSave, true);
  await page
    .getByRole("button", { name: "Research collection", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Research Collection", exact: true })
    .waitFor();
  await page.getByText("0 selected", { exact: true }).waitFor();
  assert.equal(await page.locator(".collection-card").count(), 22);
  await page.screenshot({ path: "output/playwright/research-collection.png" });
  assert.equal(
    await page.getByLabel("Add FlowWise", { exact: true }).count(),
    0,
  );
  assert.equal(await page.getByLabel("Add PACC", { exact: true }).count(), 0);
  let importedResearch = await page
    .evaluate(() => window.research.load())
    .then((s) => s.projects);
  assert.equal(importedResearch.length, 26);
  assert.equal(
    importedResearch.find((p) => p.catalogId === "flowwise").stage,
    "accepted",
  );
  assert.ok(
    importedResearch
      .find((p) => p.catalogId === "pacc")
      .links.some((link) => link.url.includes("overleaf.com/project/")),
  );
  await page.getByRole("tab", { name: "Needs review", exact: false }).click();
  assert.equal(await page.locator(".collection-card").count(), 12);
  assert.equal(
    await page
      .locator('.collection-card input[type="checkbox"]:checked')
      .count(),
    0,
  );
  await page
    .getByRole("tab", { name: "Research archive", exact: false })
    .click();
  assert.equal(await page.locator(".collection-card").count(), 10);
  const archived = await page.evaluate(async () =>
    (await window.research.researchCatalog()).candidates.find(
      (c) => c.collection === "archive",
    ),
  );
  await page
    .getByLabel(`Add ${archived.project.name}`, { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Add selected projects", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Project Board", exact: true })
    .waitFor();
  assert.equal(await page.locator(".board-card").count(), 27);
  assert.equal(
    await page
      .locator(".area-projects")
      .getByRole("button", { name: archived.project.name, exact: true })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "Overview", exact: false }).click();
  await page
    .locator(".project-card-body")
    .filter({ hasText: "FlowWise" })
    .click();
  await page
    .getByRole("heading", { name: "Sources & manuscripts", exact: false })
    .waitFor();
  await closeApp();
  ({ app, page } = await launchApp());
  importedResearch = await page.evaluate(
    async () => (await window.research.load()).projects,
  );
  assert.equal(importedResearch.length, 27);
  assert.equal(
    importedResearch.find((p) => p.catalogId === "pacc").stage,
    "revision",
  );
  assert.equal(
    importedResearch.find((p) => p.catalogId === "flowwise").stage,
    "accepted",
  );
  assert.equal(
    importedResearch.filter((p) => p.catalogId === "flowwise").length,
    1,
  );
  return "PASS: create project, task, milestone, stage change, PTY shell, PDF compilation/preview, compile failure, Ctrl+S/Command+S file save, compile on save, local folder trees with rename and trash, pane dragging/keyboard/reset/minimum widths/layout persistence, current research in sidebar and board, area filtering, provenance, and restart persistence. Screenshots are in output/playwright.";
});
