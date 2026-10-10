import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, degrees } from "pdf-lib";
import {
  closeApp,
  launchApp,
  smoke,
  stubDialogs,
  useProject,
} from "./smoke-harness.mjs";
let projectId;
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
// Opens the stubbed PDF from the empty pane, or from the versions menu once a
// PDF is showing.
async function openPdf(page) {
  await page.locator(".pdf-reader, .pdf-empty .button").first().waitFor();
  if (await page.locator(".pdf-reader").count())
    await page.getByTitle("Annotated PDF versions").click();
  await page.getByRole("button", { name: "Open PDF", exact: true }).click();
}
async function open(page) {
  await page
    .getByRole("button", { name: "PDF Annotation Review", exact: true })
    .click();
  await openPdf(page);
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await page.getByTitle("Expand PDF preview").click();
  await fitReady(page);
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
}
// The notes drawer stays open across PDFs of a project, so open it only when closed.
async function showNotes(page) {
  const toggle = page.getByTitle("Show PDF annotations");
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
}
// Polls from Node: waitForFunction treats a pending promise as a truthy result.
async function waitSaved(page, count) {
  for (let tries = 0; ; tries++) {
    const entries = await page.evaluate(
      (id) => window.research.pdfAnnotationLibrary(id),
      projectId,
    );
    if (entries.some((entry) => entry.count === count)) break;
    assert.ok(tries < 100, `Annotations never reached ${count}`);
    await page.waitForTimeout(100);
  }
  await page.getByTitle("Annotations saved", { exact: true }).waitFor();
}
await smoke("pdf-annotations", async (root) => {
  const folder = path.join(root, "manuscript"),
    source = path.join(folder, "paper.pdf"),
    dialogs = { open: source, save: path.join(root, "annotated.pdf") };
  await fs.mkdir(folder);
  const original = await makePdf();
  await fs.writeFile(source, original);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}Research evidence\\end{document}",
  );
  let { app, page } = await launchApp();
  await stubDialogs(app, dialogs);
  projectId = await useProject(page, "PDF Annotation Review", folder);
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
  const savedNote = await page.evaluate(async (id) => {
    const url = document.querySelector(".pdf-reader").dataset.pdfUrl;
    return (await window.research.readPdfAnnotations(id, url)).annotations.find(
      (item) => item.kind === "note",
    );
  }, projectId);
  assert.equal(savedNote.comment, "检查实验结果，补充消融实验。");
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
  await showNotes(page);
  await page.getByLabel("Search PDF annotations").fill("消融");
  await page.locator(".pdf-note-row").filter({ hasText: "消融" }).waitFor();
  assert.equal(await page.locator(".pdf-note-row").count(), 1);
  await page.getByLabel("Search PDF annotations").fill("");
  await page
    .locator(".pdf-note-row")
    .filter({ hasText: "检查实验结果" })
    .click();
  await page.screenshot({
    path: "output/playwright/pdf-annotations-light.png",
  });
  await page.getByTitle("Export annotated PDF").click();
  await page.getByTitle("Annotated PDF exported", { exact: true }).waitFor();
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
  await openPdf(page);
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
    .locator(".pdf-version-entry > button:first-child")
    .filter({ hasText: "3 annotations" })
    .click();
  await page.waitForFunction(
    (url) => document.querySelector(".pdf-reader")?.dataset.pdfUrl !== url,
    revisedUrl,
  );
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await stubDialogs(app, { save: source });
  const revisedBytes = await fs.readFile(source);
  await page.getByTitle("Export annotated PDF").click();
  await page
    .getByRole("alert")
    .filter({ hasText: "preserve the original PDF" })
    .waitFor();
  assert.deepEqual(await fs.readFile(source), revisedBytes);
  await showNotes(page);
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
  await closeApp();
  ({ app, page } = await launchApp());
  await stubDialogs(app, dialogs);
  await open(page);
  await page.getByTitle("Annotated PDF versions").click();
  await page
    .locator(".pdf-version-entry > button:first-child")
    .filter({ hasText: "3 annotations" })
    .click();
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await showNotes(page);
  await page
    .locator(".pdf-note-row")
    .filter({ hasText: "检查实验结果" })
    .waitFor();
  assert.equal(await page.locator(".pdf-reader-error").count(), 0);
  return "PDF annotation UI passed: text highlights, notes, ink, zoom, undo, search, Unicode export, rotated pages, version archives and restart persistence.";
});
