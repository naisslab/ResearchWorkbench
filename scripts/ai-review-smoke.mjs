import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  launchApp,
  resizeWindow,
  smoke,
  useProject,
} from "./smoke-harness.mjs";

await smoke("ai-review", async (root) => {
  const folder = path.join(root, "manuscript");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "Original manuscript\nOriginal second line\n",
  );
  await fs.writeFile(
    path.join(folder, "removed.tex"),
    "Deleted by the agent\n",
  );
  const { app: desktop, page } = await launchApp();
  const projectId = await useProject(page, "Change Review", folder);
  // Isolated conversation fixture, backed by the packaged production snapshot
  // and restore implementation. No account or model inference is required.
  await desktop.evaluate(
    async ({ app, ipcMain, BrowserWindow }, { root, folder, projectId }) => {
      const requireApp = process
        .getBuiltinModule("node:module")
        .createRequire(app.getAppPath() + "/package.json");
      const { createChangeStore, reviewKey, legacyReview } = requireApp(
        "./electron/ai-changes.cjs",
      );
      const fs = process.getBuiltinModule("node:fs/promises");
      const store = createChangeStore(root + "/snapshots");
      const id = reviewKey("review-profile", projectId, "review-run");
      const { PDFDocument } = requireApp("pdf-lib");
      const createPdf = async (text) => {
        const doc = await PDFDocument.create();
        doc.addPage().drawText(text, { x: 45, y: 700, size: 18 });
        return doc.save();
      };
      await fs.mkdir(folder + "/.research-build", { recursive: true });
      await fs.writeFile(
        folder + "/.research-build/main.pdf",
        await createPdf("Original paper result"),
      );
      await store.begin(id, [folder], { folder, mainFile: "main.tex" });
      await fs.writeFile(
        folder + "/main.tex",
        "Revised manuscript\nUpdated second line\n",
      );
      await fs.unlink(folder + "/removed.tex");
      await fs.writeFile(folder + "/check.cjs", "console.log('new check')\n");
      await fs.writeFile(
        folder + "/.research-build/main.pdf",
        await createPdf("Revised paper result"),
      );
      const summary = await store.finish(id);
      const state = {
        status: "connected",
        sharing: true,
        activeProfileId: "review-profile",
        profiles: [
          {
            id: "review-profile",
            label: "review@example.test",
            status: "connected",
            sharing: true,
          },
        ],
        models: [
          {
            slug: "review-model",
            displayName: "Review Model",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced" },
            ],
            serviceTiers: [],
          },
        ],
        usage: {
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
          unreportedRequests: 1,
        },
        runtime: { available: true, version: "0.160.0" },
      };
      const conversation = {
        projectId,
        profileId: "review-profile",
        agentRootId: "primary",
        queue: [],
        messages: [
          {
            id: "legacy-run",
            role: "assistant",
            text: "Older saved patch",
            status: "completed",
            createdAt: new Date().toISOString(),
            diff: "--- old.tex\n+++ old.tex\n@@ -1 +1 @@\n-old\n+new\n",
          },
          {
            id: "review-run",
            role: "assistant",
            text: "Updated three files using a command.",
            status: "completed",
            createdAt: new Date().toISOString(),
            review: summary,
            activities: [],
          },
        ],
      };
      const emit = () =>
        BrowserWindow.getAllWindows()[0].webContents.send(
          "ai:conversation",
          conversation,
        );
      const handlers = {
        "ai:state": () => state,
        "ai:models": () => state,
        "ai:conversation": () => conversation,
        "ai:skills": () => ({ skills: [], warnings: 0 }),
        "ai:paper": () => store.paper(id),
        "ai:paper-build": async () => {
          await store.validatePaperBuild(id, [folder], {
            folder,
            mainFile: "main.tex",
          });
          await store.recordPaperBuild(id, {
            ok: true,
            log: "Build completed\nLaTeX Warning: Review warning",
          });
          return store.paper(id);
        },
        "ai:review": (_project, message) =>
          message === "legacy-run"
            ? legacyReview(conversation.messages[0]).review
            : store.review(id, [folder]),
        "ai:review-file": (_project, message, file) =>
          message === "legacy-run"
            ? legacyReview(conversation.messages[0]).files.find(
                (item) => item.id === file,
              )
            : store.file(id, file),
        "ai:revert": async (_project, _message, fileIds) => {
          const result = await store.revert(id, [folder], fileIds);
          conversation.messages[1].review.revertedFiles = result.revertedFiles;
          conversation.messages[1].review.revertedAt = result.revertedAt;
          emit();
          return conversation;
        },
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (_event, ...args) => {
          try {
            return { ok: true, value: await handler(...args) };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: error.code || "fixture_error",
                message: error.message,
              },
            };
          }
        });
      }
    },
    { root, folder, projectId },
  );
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Change Review", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await page
    .locator(".bottom-tabs")
    .getByRole("button", { name: "AI", exact: true })
    .click();
  const reviewButton = page.locator(
    '[data-message-id="review-run"] .ai-review-button',
  );
  const dialog = page.getByRole("dialog", {
    name: "Review changes",
    exact: true,
  });
  const files = dialog.getByRole("navigation", { name: "Changed files" });
  const revert = dialog.getByRole("button", {
    name: "Revert this run",
    exact: true,
  });
  const openReview = async () => {
    await reviewButton.click();
    await files.getByRole("button", { name: /main.tex/ }).click();
    await dialog.locator(".ai-file-diff .addition").first().waitFor();
  };
  await openReview();
  await dialog
    .getByRole("button", { name: "Paper result", exact: true })
    .click();
  await dialog.getByText(/Compared 1 of 1 pages/).waitFor();
  assert.equal(await dialog.locator(".ai-paper-columns canvas").count(), 2);
  await dialog
    .getByRole("button", { name: "Compile and verify this run", exact: true })
    .click();
  await dialog.getByText("Verified build succeeded", { exact: true }).waitFor();
  await dialog
    .getByText("LaTeX Warning: Review warning", { exact: true })
    .waitFor();
  await dialog.getByText(/Compared 1 of 1 pages/).waitFor();
  await page.screenshot({ path: "output/playwright/ai-paper-review.png" });
  await dialog
    .getByRole("button", { name: "Source changes", exact: true })
    .click();
  assert.equal(await files.getByRole("button").count(), 3);
  assert.match(
    await dialog.locator(".ai-file-diff .deletion").first().innerText(),
    /Original manuscript/,
  );
  assert.match(
    await dialog.locator(".ai-file-diff .addition").first().innerText(),
    /Revised manuscript/,
  );
  assert.equal(
    await dialog.locator(".ai-file-diff .addition button").first().innerText(),
    "1",
  );
  await dialog
    .getByRole("button", { name: "Before & after", exact: true })
    .click();
  assert.match(
    await dialog
      .getByRole("region", { name: "Before this request" })
      .innerText(),
    /Original second line/,
  );
  assert.match(
    await dialog
      .getByRole("region", { name: "After this request" })
      .innerText(),
    /Updated second line/,
  );
  await page.screenshot({
    path: "output/playwright/ai-review-before-after.png",
  });
  await dialog.getByRole("button", { name: "Diff", exact: true }).click();
  await page.screenshot({ path: "output/playwright/ai-review-diff.png" });
  await dialog
    .getByRole("button", { name: "Open line 2", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  const editor = page.locator(".cm-content");
  const replaceSource = async (text) => {
    await editor.click();
    await editor.press("Meta+a");
    await page.keyboard.insertText(text);
  };
  await editor.waitFor();
  assert.match(await editor.innerText(), /Updated second line/);
  // Unsaved source edits must be flushed and block revert before any file changes.
  await replaceSource("User's newer unsaved edit\n");
  await openReview();
  await revert.click();
  await dialog
    .getByText(/changed after this run/)
    .first()
    .waitFor();
  assert.equal(await revert.isDisabled(), true);
  assert.equal(
    await fs.readFile(path.join(folder, "main.tex"), "utf8"),
    "User's newer unsaved edit\n",
  );
  await fs.access(path.join(folder, "check.cjs"));
  await assert.rejects(fs.access(path.join(folder, "removed.tex")), {
    code: "ENOENT",
  });
  await files
    .getByRole("checkbox", {
      name: "Select removed.tex for revert",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Revert selected (1)", exact: true })
    .click();
  await files
    .getByRole("checkbox", {
      name: "Select removed.tex for revert",
      exact: true,
    })
    .waitFor();
  await files.getByRole("button", { name: /removed.tex.*Reverted/ }).waitFor();
  assert.equal(
    await fs.readFile(path.join(folder, "removed.tex"), "utf8"),
    "Deleted by the agent\n",
  );
  assert.equal(
    await fs.readFile(path.join(folder, "main.tex"), "utf8"),
    "User's newer unsaved edit\n",
  );
  await page.screenshot({ path: "output/playwright/ai-review-newer-edit.png" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await replaceSource("Revised manuscript\nUpdated second line\n");
  await editor.press("Meta+s");
  await page
    .getByText("Unsaved changes", { exact: true })
    .waitFor({ state: "hidden" });
  await openReview();
  await revert.click();
  await dialog
    .getByText("This run was reverted. Its saved diff remains available.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await fs.readFile(path.join(folder, "main.tex"), "utf8"),
    "Original manuscript\nOriginal second line\n",
  );
  assert.equal(
    await fs.readFile(path.join(folder, "removed.tex"), "utf8"),
    "Deleted by the agent\n",
  );
  await assert.rejects(fs.access(path.join(folder, "check.cjs")), {
    code: "ENOENT",
  });
  assert.equal(await revert.isDisabled(), true);
  await files.getByRole("button", { name: /removed.tex/ }).click();
  await dialog
    .locator(".ai-file-diff code")
    .filter({ hasText: "Deleted by the agent" })
    .waitFor();
  assert.match(
    await dialog.locator(".ai-file-diff").innerText(),
    /Deleted by the agent/,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".cm-content")
      ?.textContent?.includes("Original second line"),
  );
  assert.match(await reviewButton.innerText(), /Reverted/);
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Change Review", exact: true })
    .click();
  await openReview();
  assert.equal(await revert.isDisabled(), true);
  await page.evaluate(async () => {
    const state = await window.research.load();
    await window.research.save({ ...state, appearance: "dark" });
  });
  await page.screenshot({ path: "output/playwright/ai-review-dark.png" });
  await resizeWindow(desktop, page, 1080, 740);
  const box = await dialog.boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 1080 &&
      box.y + box.height <= 740,
  );
  await page.screenshot({ path: "output/playwright/ai-review-compact.png" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .locator('[data-message-id="legacy-run"] .ai-review-button')
    .click();
  await dialog.locator(".ai-file-diff .addition").first().waitFor();
  assert.equal(await revert.isDisabled(), true);
  assert.equal(
    await dialog
      .getByRole("button", { name: "Before & after", exact: true })
      .isDisabled(),
    true,
  );
  assert.match(
    await dialog.innerText(),
    /older run has no saved file versions/,
  );
  return "PASS: packaged per-file review, colored diff and line navigation, before/after versions, command-only changes, one-click restore of modified/added/deleted files, unsaved-edit protection, editor refresh, saved review after reload, legacy read-only patches, and compact dark layout.";
});
