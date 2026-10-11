import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { launchApp, smoke, useProject } from "./smoke-harness.mjs";

await smoke("finder", async (root) => {
  const folder = path.join(root, "manuscript");
  await fs.mkdir(folder);
  for (const name of [
    "main.tex",
    "results bundle.zip",
    "review.rar",
    "100% assets.ZIP",
  ])
    await fs.writeFile(
      path.join(folder, name),
      name === "main.tex"
        ? "Original manuscript\n"
        : Buffer.from([0, 255, 128]),
    );
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await fs.writeFile(path.join(folder, "paper.pdf"), await pdf.save());
  const { app, page } = await launchApp();
  const id = await useProject(page, "Finder files", folder);
  // Keep the production file IPC and path validation. Replace only the OS
  // action, so automated clicks do not open Finder windows on the user's Mac.
  await app.evaluate(({ ipcMain, shell }, projectId) => {
    globalThis.__finderPaths = [];
    shell.showItemInFolder = (target) => globalThis.__finderPaths.push(target);
    shell.openPath = () => {
      throw new Error("File must be revealed, never executed");
    };
    ipcMain.removeHandler("ai:conversation");
    ipcMain.handle("ai:conversation", () => ({
      ok: true,
      value: {
        projectId,
        profileId: null,
        agentRootId: "primary",
        messages: [
          {
            id: "finder-message",
            role: "assistant",
            status: "complete",
            text: "Files: [ZIP](results%20bundle.zip), [RAR](review.rar), [manuscript](main.tex:1), [PDF](paper.pdf), [missing](missing.zip), [outside](../outside.zip).",
          },
        ],
      },
    }));
  }, id);
  await fs.writeFile(path.join(root, "outside.zip"), "outside");
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Finder files", exact: true })
    .click();
  const mode = (name) =>
    page
      .getByRole("group", { name: "Workbench mode" })
      .getByRole("button", { name, exact: true });
  const link = (name) =>
    page.locator(".ai-markdown").getByRole("link", { name, exact: true });
  const revealed = () => app.evaluate(() => globalThis.__finderPaths);
  const expectRevealed = async (name, count) => {
    for (let i = 0; i < 30 && (await revealed()).length < count; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const paths = await revealed();
    assert.equal(paths.length, count);
    assert.equal(paths.at(-1), await fs.realpath(path.join(folder, name)));
  };
  await link("ZIP").click();
  await expectRevealed("results bundle.zip", 1);
  assert.equal(await mode("Agent").getAttribute("aria-pressed"), "true");
  await link("RAR").click();
  await expectRevealed("review.rar", 2);
  await page
    .getByRole("button", { name: "Show main.tex:1 in Finder", exact: true })
    .click();
  await expectRevealed("main.tex", 3);
  assert.equal(await mode("Agent").getAttribute("aria-pressed"), "true");
  await page
    .getByRole("button", { name: "Show paper.pdf in Finder", exact: true })
    .click();
  await expectRevealed("paper.pdf", 4);
  await link("PDF").click();
  await page.locator(".pdf-reader").waitFor();
  assert.equal(
    (await revealed()).length,
    4,
    "PDF preview must stay in the app",
  );
  await link("manuscript").click();
  await page.locator(".workbench.mode-columns").waitFor();
  const editor = page.locator(".cm-content");
  await editor.fill("Unsaved manuscript");
  await page
    .locator(".file-tree-row")
    .filter({ hasText: "100% assets.ZIP" })
    .click();
  await expectRevealed("100% assets.ZIP", 5);
  assert.equal(await editor.innerText(), "Unsaved manuscript");
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Revealing an archive must not prompt to discard edits",
  );
  await page
    .locator(".file-tree-row")
    .filter({ hasText: "review.rar" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Reveal in Finder", exact: true })
    .click();
  await expectRevealed("review.rar", 6);
  await link("missing").click();
  await page
    .locator(".ai-error")
    .filter({ hasText: /ENOENT|no such file/ })
    .waitFor();
  await link("outside").click();
  await page
    .locator(".ai-error")
    .filter({ hasText: /inside the project folder/ })
    .waitFor();
  assert.equal(
    (await revealed()).length,
    6,
    "Missing and outside files must not reach Finder",
  );
  await page
    .getByRole("button", { name: "Show main.tex:1 in Finder", exact: true })
    .click();
  await expectRevealed("main.tex", 7);
  await page.screenshot({ path: "output/playwright/finder-files.png" });
  return "Finder UI passed: archive links and tree clicks, explicit Finder actions, PDF/text previews, unsaved edits, encoded filenames, and invalid-path handling.";
});
