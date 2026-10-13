import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, degrees } from "pdf-lib";
import {
  launchApp,
  closeApp,
  resizeWindow,
  smoke,
  stubDialogs,
  useProject,
} from "./smoke-harness.mjs";

const mainText = String.raw`\documentclass{article}
\begin{document}
\section{Overview}
Overview sentence in the entry file.
\newpage
\input{sections/details}
\end{document}
`;
const detailsText =
  "\\section{Details}\n\nDistinct included sentence on page two.\n";

async function ready(page, number) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  try {
    await page
      .locator(
        `.project-workbench:not([hidden]) .pdf-page[data-page-number="${number}"][data-rendered="true"]`,
      )
      .waitFor({ timeout: 30000 });
  } catch (error) {
    console.error(
      "PDF layout:",
      JSON.stringify(
        await page.evaluate(() => ({
          pages: [...document.querySelectorAll(".pdf-page")].map((page) => ({
            data: { ...page.dataset },
            top: page.offsetTop,
            rect: page.getBoundingClientRect().toJSON(),
            canvas: [
              page.querySelector("canvas").width,
              page.querySelector("canvas").height,
            ],
            loading: page.querySelector(".pdf-page-loading")?.textContent,
          })),
          scroll: {
            top: document.querySelector(".pdf-scroll").scrollTop,
            height: document.querySelector(".pdf-scroll").clientHeight,
          },
        })),
        null,
        2,
      ),
    );
    throw error;
  }
}
async function goTo(page, number) {
  const reader = page.locator(".project-workbench:not([hidden])");
  await reader.getByLabel("PDF page number").fill(String(number));
  await reader.getByLabel("PDF page number").press("Enter");
  await ready(page, number);
}
async function clickText(page, number, phrase, options = {}) {
  const text = page
    .locator(
      `.project-workbench:not([hidden]) .pdf-page[data-page-number="${number}"] .textLayer span`,
    )
    .filter({ hasText: phrase })
    .first();
  await text.waitFor();
  // Source mode makes the text layer transparent to pointer input.
  await text.scrollIntoViewIfNeeded();
  await ready(page, number);
  const box = await text.boundingBox();
  assert.ok(box);
  await page.mouse.click(
    box.x + box.width / 2,
    box.y + box.height / 2,
    options,
  );
}
async function atSource(page, file, line, phrase) {
  try {
    await page.waitForFunction(
      ({ file, line, phrase }) => {
        const workbench = document.querySelector(
          ".project-workbench:not([hidden])",
        );
        const tab = workbench?.querySelector(".editor-file-tab");
        const content = workbench?.querySelector(".cm-activeLine");
        const gutter = workbench?.querySelector(".cm-activeLineGutter");
        return (
          tab?.textContent.includes(file) &&
          content?.textContent.includes(phrase) &&
          Number(gutter?.textContent) === line &&
          document.activeElement?.closest(".cm-editor")
        );
      },
      { file, line, phrase },
      { timeout: 5000 },
    );
  } catch (error) {
    console.error(
      "Source cursor:",
      await page.evaluate(() => ({
        file: document.querySelector(".editor-file-tab")?.textContent,
        line: document.querySelector(".cm-activeLineGutter")?.textContent,
        text: document.querySelector(".cm-activeLine")?.textContent,
        focused: document.activeElement?.className,
      })),
    );
    throw error;
  }
}

await smoke("synctex", async (root) => {
  const folder = path.join(root, "paper with spaces");
  await fs.mkdir(path.join(folder, "sections"), { recursive: true });
  await fs.writeFile(path.join(folder, "main.tex"), mainText);
  await fs.writeFile(path.join(folder, "sections", "details.tex"), detailsText);
  let { app, page } = await launchApp();
  const id = await useProject(page, "PDF Source Lookup", folder);
  const result = await page.evaluate((id) => window.research.compile(id), id);
  assert.equal(result.ok, true, result.log);
  await page.reload();
  await page
    .getByRole("button", { name: "PDF Source Lookup", exact: true })
    .click();
  await ready(page, 1);

  // A double-click opens the editor from the default Agent mode.
  await clickText(page, 1, "Overview sentence", { clickCount: 2 });
  await atSource(page, "main.tex", 4, "Overview sentence");
  assert.equal(await page.locator(".editor-pane:visible").count(), 1);
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();

  // SyncTeX opens the included file rather than the entry's input statement.
  await goTo(page, 2);
  await clickText(page, 2, "Distinct included sentence", { clickCount: 2 });
  await atSource(page, "sections/details.tex", 3, "Distinct included sentence");

  // Explicit source mode supports one click after zooming and resizing.
  await page
    .getByRole("button", { name: "Jump to source", exact: true })
    .click();
  await page.getByTitle("Zoom in PDF").click();
  await resizeWindow(app, page, 1250, 900);
  await goTo(page, 1);
  await clickText(page, 1, "Overview sentence");
  await atSource(page, "main.tex", 4, "Overview sentence");
  await page.getByTitle("Expand PDF preview").click();
  await goTo(page, 2);
  await clickText(page, 2, "Distinct included sentence");
  await atSource(page, "sections/details.tex", 3, "Distinct included sentence");
  assert.equal(await page.locator(".editor-pane:visible").count(), 1);

  // Same-file jumps refocus a source editor hidden by the Agent layout.
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Agent", exact: true })
    .click();
  await goTo(page, 2);
  await clickText(page, 2, "Distinct included sentence");
  await atSource(page, "sections/details.tex", 3, "Distinct included sentence");
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();

  // Existing modifier-click behavior remains available without changing tools.
  await page.getByRole("button", { name: "Select text", exact: true }).click();
  await goTo(page, 1);
  await page.keyboard.down("Meta");
  await clickText(page, 1, "Overview sentence");
  await page.keyboard.up("Meta");
  await atSource(page, "main.tex", 4, "Overview sentence");

  // Navigating within a dirty file retains edits; crossing files prompts first.
  await page
    .locator(".cm-content")
    .fill(mainText + "% Unsaved manuscript change\n");
  await clickText(page, 1, "Overview sentence", { clickCount: 2 });
  await atSource(page, "main.tex", 4, "Overview sentence");
  assert.match(
    await page.locator(".cm-content").innerText(),
    /Unsaved manuscript change/,
  );
  await goTo(page, 2);
  await clickText(page, 2, "Distinct included sentence", { clickCount: 2 });
  await page
    .getByRole("dialog")
    .filter({ hasText: "Save changes to main.tex?" })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.match(
    await page.locator(".cm-content").innerText(),
    /Unsaved manuscript change/,
  );
  assert.equal(
    await fs.readFile(path.join(folder, "main.tex"), "utf8"),
    mainText,
  );
  await clickText(page, 2, "Distinct included sentence", { clickCount: 2 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await atSource(page, "sections/details.tex", 3, "Distinct included sentence");
  assert.match(
    await fs.readFile(path.join(folder, "main.tex"), "utf8"),
    /Unsaved manuscript change/,
  );
  assert.equal(
    await page.locator(".pdf-mark-layer rect, .pdf-note-pin").count(),
    0,
  );
  await page.screenshot({ path: "output/playwright/pdf-source-lookup.png" });

  // Failed compilation retains a usable PDF with its previous source map.
  const detailsFile = path.join(folder, "sections", "details.tex");
  await fs.writeFile(
    detailsFile,
    "\\section{Details}\n\n\\UndefinedSourceLookupCommand\n",
  );
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page.getByText("Build failed", { exact: false }).waitFor();
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await goTo(page, 2);
  await clickText(page, 2, "Distinct included sentence", { clickCount: 2 });
  await atSource(
    page,
    "sections/details.tex",
    3,
    "UndefinedSourceLookupCommand",
  );
  await fs.writeFile(detailsFile, detailsText);
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page
    .locator('.build-summary[data-state="ok"]')
    .waitFor({ state: "attached" });
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();

  // A missing map shows actionable feedback without moving the source cursor.
  const pdfFile = path.join(folder, ".research-build", "main.pdf");
  const mapFile = pdfFile.replace(/\.pdf$/, ".synctex.gz");
  await fs.rm(mapFile);
  await goTo(page, 1);
  await clickText(page, 1, "Overview sentence", { clickCount: 2 });
  await page
    .getByRole("alert")
    .filter({ hasText: "No source line was found" })
    .waitFor();
  assert.match(
    await page.locator(".editor-file-tab").innerText(),
    /sections\/details.tex/,
  );
  await page.getByLabel("Dismiss source lookup error").click();
  // Compile must repair the missing map even though the source is unchanged.
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page.getByRole("button", { name: "Compile", exact: true }).waitFor();
  assert.ok((await fs.stat(mapFile)).size > 0);
  await ready(page, 1);
  await clickText(page, 1, "Overview sentence", { clickCount: 2 });
  await atSource(page, "main.tex", 4, "Overview sentence");

  // The repaired map survives renderer reloads, application sessions and project switches.
  const secondFolder = path.join(root, "second paper");
  await fs.mkdir(secondFolder);
  await fs.writeFile(
    path.join(secondFolder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nSecond project has its own source.\n\\end{document}\n",
  );
  await page.evaluate(
    async ({ id, folder }) => {
      const state = await window.research.load();
      const original = state.projects.find((p) => p.id === id);
      state.projects.push({
        ...original,
        id: "synctex-second",
        name: "Second PDF project",
        folder,
      });
      await window.research.save(state);
      const result = await window.research.compile("synctex-second");
      if (!result.ok) throw new Error(result.log);
    },
    { id, folder: secondFolder },
  );
  await closeApp();
  ({ app, page } = await launchApp());
  await page
    .getByRole("button", { name: "PDF Source Lookup", exact: true })
    .click();
  await goTo(page, 2);
  await clickText(page, 2, "Distinct included sentence", { clickCount: 2 });
  await atSource(page, "sections/details.tex", 3, "Distinct included sentence");
  await page
    .getByRole("button", { name: "Second PDF project", exact: true })
    .click();
  await ready(page, 1);
  await clickText(page, 1, "Second project has", { clickCount: 2 });
  await atSource(page, "main.tex", 3, "Second project has");
  await page
    .getByRole("button", { name: "PDF Source Lookup", exact: true })
    .click();
  await goTo(page, 1);
  await clickText(page, 1, "Overview sentence", { clickCount: 2 });
  await atSource(page, "main.tex", 4, "Overview sentence");
  await page.reload();
  await ready(page, 1);
  await clickText(page, 1, "Overview sentence", { clickCount: 2 });
  await atSource(page, "main.tex", 4, "Overview sentence");

  // Refuse stale PDF sessions, then map rotated pages with their actual viewport.
  const oldUrl = await page.locator(".pdf-reader").getAttribute("data-pdf-url");
  const rotated = await PDFDocument.load(await fs.readFile(pdfFile));
  rotated.getPages().forEach((page) => page.setRotation(degrees(90)));
  await fs.writeFile(pdfFile, await rotated.save());
  const stale = await page.evaluate(
    async ({ id, url }) => {
      try {
        await window.research.synctexInverse(id, 1, 100, 100, url);
      } catch (error) {
        return error.message;
      }
    },
    { id, url: oldUrl },
  );
  assert.match(stale, /PDF has changed on disk/);
  const staleForward = await page.evaluate(
    async ({ id, url }) => {
      try {
        await window.research.synctexForward(id, "main.tex", 4, "primary", url);
      } catch (error) {
        return error.message;
      }
    },
    { id, url: oldUrl },
  );
  assert.match(staleForward, /PDF has changed on disk/);
  await page.reload();
  await page
    .getByRole("button", { name: "PDF Source Lookup", exact: true })
    .click();
  await ready(page, 1);
  await clickText(page, 1, "Overview sentence", { clickCount: 2 });
  await atSource(page, "main.tex", 4, "Overview sentence");

  // An unrelated local PDF must not use the manuscript's source map.
  const external = path.join(root, "unrelated.pdf");
  const other = await PDFDocument.create();
  other.addPage().drawText("Unrelated external paper", { x: 60, y: 700 });
  await fs.writeFile(external, await other.save());
  await stubDialogs(app, { open: external });
  await page.getByTitle("Annotated PDF versions").click();
  await page.getByRole("button", { name: "Open PDF", exact: true }).click();
  await ready(page, 1);
  await clickText(page, 1, "Unrelated external paper", { clickCount: 2 });
  await page
    .getByRole("alert")
    .filter({ hasText: "Source lookup requires this project's compiled PDF" })
    .waitFor();
  assert.match(await page.locator(".editor-file-tab").innerText(), /main.tex/);

  return "PDF source lookup UI passed: missing-map repair, application restart, project switches, renderer reload, double-click, source tool, modifier-click, included files, page two, zoom, resize, expanded/Agent layouts, cursor focus, unsaved edits, failed builds, stale sessions, rotation and unrelated PDFs.";
});
