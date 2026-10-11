import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  closeApp,
  dragDivider,
  launchApp,
  resizeWindow,
  smoke,
  stubDialogs,
  useProject,
} from "./smoke-harness.mjs";

await smoke("layout", async (root) => {
  const folder = path.join(root, "manuscript");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    String.raw`\documentclass{article}
\begin{document}
\section{Three-column Workbench}
Review the source, ask the agent, and read the manuscript side by side.
\end{document}
`,
  );
  const document = await PDFDocument.create();
  for (let index = 1; index <= 3; index++) {
    const sheet = document.addPage([600, 800]);
    sheet.drawText(`Three-column manuscript: page ${index}`, {
      x: 50,
      y: 700,
      size: 18,
    });
  }
  const pdfPath = path.join(folder, "paper.pdf");
  await fs.writeFile(pdfPath, await document.save());
  let { app, page } = await launchApp();
  const resize = (width, height) => resizeWindow(app, page, width, height);
  await useProject(page, "Layout Review", folder);
  await resize(2200, 1100);
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Workspace Settings", exact: true })
    .waitFor();
  const settings = await page.evaluate(() => {
    const scroll = document.querySelector(".page-scroll");
    const content = document.querySelector(".settings-page");
    const bounds = content.getBoundingClientRect();
    const parent = scroll.getBoundingClientRect();
    const heading = document
      .querySelector(".page-heading")
      .getBoundingClientRect();
    const cards = document
      .querySelector(".settings-layout")
      .getBoundingClientRect();
    return {
      centered:
        Math.abs(
          bounds.left - parent.left - (scroll.clientWidth - bounds.width) / 2,
        ) < 2,
      aligned: Math.abs(heading.left - cards.left) < 1,
      width: bounds.width,
    };
  });
  assert.ok(
    settings.centered && settings.aligned && settings.width <= 918,
    "Settings heading and cards must share a centered content column",
  );
  await page.screenshot({ path: "output/playwright/settings-centered.png" });
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Layout Review", exact: true })
    .click();
  await page.locator(".cm-content").waitFor({ state: "attached" });
  await stubDialogs(app, { open: pdfPath });
  await page.getByRole("button", { name: "Open PDF", exact: true }).click();
  await page.locator('.pdf-page[data-rendered="true"]').first().waitFor();
  const mode = (name) =>
    page
      .getByRole("group", { name: "Workbench mode" })
      .getByRole("button", { name, exact: true });
  await mode("Source + Agent + PDF").click();
  await page
    .getByRole("button", { name: "Continue with ChatGPT", exact: false })
    .waitFor();
  const draft = page.getByLabel("Message the AI agent");
  await draft.fill("Review this paragraph alongside the PDF.");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("\n% Unsaved layout review");
  await page.evaluate(() => {
    window.__layoutNodes = [".cm-content", ".ai-panel", ".pdf-reader"].map(
      (selector) => document.querySelector(selector),
    );
    window.__layoutText = document.querySelector(".cm-content").textContent;
  });
  const checkColumns = async (overflow = false) => {
    await page.waitForFunction(() => {
      const source = document
        .querySelector(".editor-pane")
        .getBoundingClientRect();
      const chat = document
        .querySelector(".bottom-panel")
        .getBoundingClientRect();
      const pdf = document.querySelector(".pdf-pane").getBoundingClientRect();
      return (
        source.right <= chat.left &&
        chat.right <= pdf.left &&
        source.height > 500 &&
        chat.height > 500 &&
        pdf.height > 500
      );
    });
    const panes = await page.evaluate(() => {
      const workbench = document.querySelector(".workbench");
      const rect = (selector) => {
        const { left, right, top, bottom, width, height } = document
          .querySelector(selector)
          .getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const ai = document.querySelector(".ai-panel");
      return {
        source: rect(".editor-pane"),
        agent: rect(".bottom-panel"),
        pdf: rect(".pdf-pane"),
        composer: rect(".ai-composer"),
        fits: ai.scrollWidth <= ai.clientWidth + 1,
        overflow: workbench.scrollWidth > workbench.clientWidth + 1,
        viewport: innerHeight,
      };
    });
    assert.ok(
      panes.source.width >= 240 &&
        panes.agent.width >= 360 &&
        panes.pdf.width >= 260,
    );
    assert.ok(panes.fits && panes.composer.bottom <= panes.viewport);
    assert.ok(
      Math.abs(panes.source.bottom - panes.agent.bottom) < 2 &&
        Math.abs(panes.pdf.bottom - panes.agent.bottom) < 2,
    );
    assert.equal(panes.overflow, overflow);
    return panes;
  };
  await checkColumns();
  const sourceDivider = page.getByRole("separator", {
    name: "Resize source column",
    exact: true,
  });
  const agentDivider = page.getByRole("separator", {
    name: "Resize agent and PDF",
    exact: true,
  });
  const sourceBefore = Number(
    await sourceDivider.getAttribute("aria-valuenow"),
  );
  await sourceDivider.focus();
  await sourceDivider.press("Shift+ArrowRight");
  assert.ok(
    Number(await sourceDivider.getAttribute("aria-valuenow")) >=
      sourceBefore + 49,
  );
  const agentBefore = Number(await agentDivider.getAttribute("aria-valuenow"));
  assert.ok(
    (await dragDivider(page, "Resize agent and PDF", 50)) >= agentBefore + 49,
  );
  await checkColumns();
  const savedWidths = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        "research-workbench.project-panels." +
          document.querySelector(".project-workbench:not([hidden])").dataset
            .projectId,
      ),
    ),
  );
  for (const name of [
    "Source + PDF",
    "Agent + PDF",
    "All panels",
    "Source + Agent + PDF",
  ]) {
    await mode(name).click();
    assert.ok(
      await page.evaluate(() =>
        [".cm-content", ".ai-panel", ".pdf-reader"].every(
          (selector, index) =>
            document.querySelector(selector) === window.__layoutNodes[index],
        ),
      ),
      "Mode switches must retain the mounted editor, conversation and PDF",
    );
  }
  assert.equal(
    await draft.inputValue(),
    "Review this paragraph alongside the PDF.",
  );
  assert.equal(
    await page.locator(".cm-content").textContent(),
    await page.evaluate(() => window.__layoutText),
  );
  await page.screenshot({
    path: "output/playwright/source-agent-pdf-wide.png",
  });
  await page.getByTitle("Expand AI panel", { exact: true }).click();
  assert.equal(await page.locator(".editor-pane").isVisible(), false);
  assert.equal(await page.locator(".pdf-pane").isVisible(), false);
  await page
    .locator(".bottom-tabs")
    .getByTitle("Restore split view", { exact: true })
    .click();
  await checkColumns();
  await page.getByTitle("Expand PDF preview", { exact: true }).click();
  assert.equal(await page.locator(".editor-pane").isVisible(), false);
  assert.equal(await page.locator(".ai-panel").isVisible(), false);
  await page
    .locator(".pdf-pane")
    .getByTitle("Restore split view", { exact: true })
    .click();
  await checkColumns();
  for (const name of ["Terminal", "Build log", "AI"]) {
    await page
      .locator(".bottom-tabs")
      .getByRole("button", { name, exact: true })
      .click();
    await checkColumns();
  }
  await page.getByRole("button", { name: "Hide panel", exact: true }).click();
  assert.equal(await page.locator(".ai-panel").isVisible(), false);
  assert.equal(await page.locator(".editor-pane").isVisible(), true);
  assert.equal(await page.locator(".pdf-pane").isVisible(), true);
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "AI", exact: true })
    .click();
  await checkColumns();
  await page
    .locator(".toolbar-actions")
    .getByRole("button", { name: "PDF", exact: true })
    .click();
  assert.equal(await page.locator(".pdf-pane").count(), 0);
  assert.equal(await page.locator(".ai-panel").isVisible(), true);
  await page
    .locator(".toolbar-actions")
    .getByRole("button", { name: "PDF", exact: true })
    .click();
  await checkColumns();
  await resize(1050, 760);
  await checkColumns(true);
  await page
    .locator(".workbench")
    .evaluate((node) => (node.scrollLeft = node.scrollWidth));
  assert.ok((await page.locator(".pdf-pane").boundingBox()).x < 1050);
  await page.screenshot({
    path: "output/playwright/source-agent-pdf-compact.png",
  });
  await resize(2200, 1100);
  const restored = await checkColumns();
  assert.ok(Math.abs(restored.source.width - savedWidths.sourceWidth) < 1);
  assert.ok(Math.abs(restored.agent.width - savedWidths.columnsAgentWidth) < 1);
  await page.getByRole("button", { name: "Save", exact: false }).click();
  await page
    .getByRole("button", { name: "Save", exact: false })
    .waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".unsaved-dot"));
  await closeApp();
  ({ app, page } = await launchApp());
  await resize(2200, 1100);
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Layout Review", exact: true })
    .click();
  assert.equal(
    await mode("Source + Agent + PDF").getAttribute("aria-pressed"),
    "true",
  );
  const persisted = await checkColumns();
  assert.ok(Math.abs(persisted.source.width - savedWidths.sourceWidth) < 1);
  assert.ok(
    Math.abs(persisted.agent.width - savedWidths.columnsAgentWidth) < 1,
  );
  await page.getByTitle("Reset panel layout", { exact: true }).click();
  const reset = await checkColumns();
  assert.ok(Math.abs(reset.source.width - reset.agent.width) < 1);
  assert.ok(Math.abs(reset.source.width - reset.pdf.width) < 1);
  await page.screenshot({
    path: "output/playwright/source-agent-pdf-default.png",
  });
  return "Layout UI passed: centered Settings, full-height three columns, resizing, state preservation, focus/restore, hidden panels, compact scrolling, persisted sizes and reset.";
});
