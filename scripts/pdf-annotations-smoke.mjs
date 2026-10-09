import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, degrees } from "pdf-lib";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-pdf-ui-"));
const folder = path.join(root, "manuscript"),
  source = path.join(folder, "paper.pdf");
let desktop, currentPage;
const failures = [];
async function makePdf(revised = false) {
  const pdf = await PDFDocument.create();
  pdf
    .addPage([600, 800])
    .drawText(
      revised ? "Updated research evidence" : "Research evidence for review",
      { x: 50, y: 680, size: 18 },
    );
  const second = pdf.addPage([600, 800]);
  second.drawText("Second page evaluation", { x: 50, y: 680, size: 18 });
  second.setRotation(degrees(90));
  return Buffer.from(await pdf.save());
}
async function launch() {
  desktop = await electron.launch({
    executablePath: process.env.RESEARCH_APP_PATH || undefined,
    args: process.env.RESEARCH_APP_PATH ? [] : ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      RESEARCH_TEST_DATA: path.join(root, "user-data"),
      RESEARCH_DEV_URL: "",
    },
  });
  const page = await desktop.firstWindow();
  currentPage = page;
  page.on("pageerror", (error) => failures.push(error.message));
  await page
    .getByRole("heading", { name: "Research Overview", exact: true })
    .waitFor();
  await desktop.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths.source],
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: paths.exported,
      });
    },
    { source, exported: path.join(root, "annotated.pdf") },
  );
  return page;
}
async function fitReady(page) {
  await page.waitForFunction(() => {
    const scroll = document.querySelector(".pdf-scroll");
    const first = document.querySelector('.pdf-page[data-page-number="1"]');
    return (
      first?.dataset.rendered === "true" &&
      Math.abs(
        first.getBoundingClientRect().width - (scroll.clientWidth - 64),
      ) < 2
    );
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function open(page) {
  await page
    .getByRole("button", { name: "PDF Annotation Review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open PDF", exact: true })
    .first()
    .click();
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await page.getByTitle("Expand PDF preview").click();
  await fitReady(page);
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
}
async function waitSaved(page, count) {
  await page.waitForFunction(
    async ({ id, count }) => {
      const entries = await window.research.pdfAnnotationLibrary(id);
      return entries.some((entry) => entry.count === count);
    },
    { id: projectId, count },
  );
  await page.getByText("Annotations saved", { exact: true }).waitFor();
}
let projectId;
try {
  await fs.mkdir(folder);
  const original = await makePdf();
  await fs.writeFile(source, original);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}Research evidence\\end{document}",
  );
  let page = await launch();
  projectId = await page.evaluate(async (folder) => {
    const workspace = await window.research.load();
    const project = workspace.projects[0];
    Object.assign(project, {
      name: "PDF Annotation Review",
      folder,
      localFolders: [],
      mainFile: "main.tex",
    });
    workspace.appearance = "light";
    await window.research.save(workspace);
    return project.id;
  }, folder);
  await page.reload();
  await open(page);
  await page
    .getByRole("button", { name: "Highlight text", exact: true })
    .click();
  const text = page
    .locator('.pdf-page[data-page-number="1"] .textLayer span')
    .filter({ hasText: "Research evidence for review" });
  const bounds = await text.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 1,
    bounds.y + bounds.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  await waitSaved(page, 1);
  const highlight = await page.evaluate(async (id) => {
    const url = document.querySelector(".pdf-reader").dataset.pdfUrl;
    return (await window.research.readPdfAnnotations(id, url)).annotations[0];
  }, projectId);
  assert.match(highlight.quote, /Research evidence/);
  assert.ok(Math.abs(highlight.rects[0].x - 50) < 3);
  const before = await page
    .locator(".pdf-mark-layer rect")
    .first()
    .boundingBox();
  await page.getByTitle("Zoom in PDF").click();
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  const after = await page
    .locator(".pdf-mark-layer rect")
    .first()
    .boundingBox();
  assert.ok(Math.abs(after.width / before.width - 1.15) < 0.03);
  await page.getByTitle("Fit PDF to width").click();
  await fitReady(page);
  await page.getByRole("button", { name: "Add PDF note", exact: true }).click();
  await page
    .locator('.pdf-page[data-page-number="1"]')
    .click({ position: { x: 250, y: 220 } });
  await page
    .getByLabel("Annotation comment", { exact: true })
    .fill("检查实验结果，补充消融实验。");
  await page.keyboard.press("Control+s");
  await waitSaved(page, 2);
  await page.getByTitle("Close PDF annotations").click();
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
  await page
    .getByRole("button", { name: "blue annotation color", exact: true })
    .click();
  const box = await page
    .locator('.pdf-page[data-page-number="1"]')
    .boundingBox();
  await page.mouse.move(box.x + 90, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 305, { steps: 15 });
  await page.mouse.up();
  await waitSaved(page, 3);
  await page.getByTitle("Undo PDF annotation").click();
  await waitSaved(page, 2);
  await page.mouse.move(box.x + 90, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 305, { steps: 15 });
  await page.mouse.up();
  await waitSaved(page, 3);
  await page.getByTitle("Show PDF annotations").click();
  await page.getByLabel("Search PDF annotations").fill("消融");
  assert.equal(await page.locator(".pdf-note-row").count(), 1);
  await page.getByLabel("Search PDF annotations").fill("");
  await page
    .locator(".pdf-note-row")
    .filter({ hasText: "检查实验结果" })
    .click();
  await fs.mkdir("output/playwright", { recursive: true });
  await page.screenshot({
    path: "output/playwright/pdf-annotations-light.png",
  });
  await page.getByTitle("Export annotated PDF").click();
  await page.getByText("Annotated PDF exported", { exact: true }).waitFor();
  const exported = await fs.readFile(path.join(root, "annotated.pdf"));
  const exportPdf = await PDFDocument.load(exported);
  const annotations = exportPdf.getPage(0).node.Annots();
  assert.equal(annotations.size(), 3);
  assert.equal(
    exportPdf.context
      .lookup(annotations.get(1))
      .get(PDFName.of("Contents"))
      .decodeText(),
    "检查实验结果，补充消融实验。",
  );
  assert.deepEqual(await fs.readFile(source), original);
  await fs.mkdir("output/pdf", { recursive: true });
  await fs.writeFile("output/pdf/annotation-review.pdf", exported);
  // A changed build at the same path starts a separate annotation version.
  const oldUrl = await page.locator(".pdf-reader").getAttribute("data-pdf-url");
  await fs.writeFile(source, await makePdf(true));
  await page
    .getByRole("button", { name: "Open PDF", exact: true })
    .first()
    .click();
  await page.waitForFunction(
    (url) => document.querySelector(".pdf-reader")?.dataset.pdfUrl !== url,
    oldUrl,
  );
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  assert.equal(await page.locator(".pdf-mark-layer rect").count(), 0);
  const revisedUrl = await page
    .locator(".pdf-reader")
    .getAttribute("data-pdf-url");
  await page.getByTitle("Annotated PDF versions").click();
  await page
    .locator(".pdf-versions > button")
    .filter({ hasText: "3 annotations" })
    .click();
  await page.waitForFunction(
    (url) => document.querySelector(".pdf-reader")?.dataset.pdfUrl !== url,
    revisedUrl,
  );
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await desktop.evaluate(({ dialog }, source) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: source });
  }, source);
  const revisedBytes = await fs.readFile(source);
  await page.getByTitle("Export annotated PDF").click();
  await page
    .getByRole("alert")
    .filter({ hasText: "preserve the original PDF" })
    .waitFor();
  assert.deepEqual(await fs.readFile(source), revisedBytes);
  await page.getByTitle("Show PDF annotations").click();
  assert.equal(await page.locator(".pdf-note-row").count(), 3);
  assert.equal(
    await page.getByLabel("Annotation comment", { exact: true }).count(),
    0,
  );
  // Rotated pages also use PDF coordinates rather than display pixels.
  await page.getByTitle("Close PDF annotations").click();
  await page.getByLabel("PDF page number").fill("2");
  await page.getByLabel("PDF page number").press("Enter");
  await page
    .locator('.pdf-page[data-page-number="2"][data-rendered="true"]')
    .waitFor();
  await page.getByRole("button", { name: "Add PDF note", exact: true }).click();
  await page
    .locator('.pdf-page[data-page-number="2"]')
    .click({ position: { x: 100, y: 100 } });
  await page
    .getByLabel("Annotation comment", { exact: true })
    .fill("Rotated page note");
  await waitSaved(page, 4);
  await page
    .getByRole("button", { name: "Delete annotation", exact: true })
    .click();
  await waitSaved(page, 3);
  const library = await page.evaluate(
    (id) => window.research.pdfAnnotationLibrary(id),
    projectId,
  );
  assert.equal(library[0].name, "paper.pdf");
  await page.getByTitle("Switch to dark mode").click();
  await page.screenshot({ path: "output/playwright/pdf-annotations-dark.png" });
  await desktop.close();
  page = await launch();
  await open(page);
  await page.getByTitle("Annotated PDF versions").click();
  await page
    .locator(".pdf-versions > button")
    .filter({ hasText: "3 annotations" })
    .click();
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await page.getByTitle("Show PDF annotations").click();
  await page
    .locator(".pdf-note-row")
    .filter({ hasText: "检查实验结果" })
    .waitFor();
  assert.equal(await page.locator(".pdf-reader-error").count(), 0);
  assert.deepEqual(failures, []);
  console.log(
    "PDF annotation UI passed: text highlights, notes, ink, zoom, undo, search, Unicode export, rotated pages, version archives and restart persistence.",
  );
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({
      path: "output/playwright/pdf-annotations-failure.png",
    });
    console.error(
      await currentPage
        .locator(".pdf-reader")
        .innerText()
        .catch(() => "No reader"),
    );
  }
  throw error;
} finally {
  if (desktop) await desktop.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
