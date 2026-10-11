import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchApp, smoke, useProject } from "./smoke-harness.mjs";

const mainText = String.raw`\documentclass{article}
\author{Shinan Liu}
\begin{document}
\section{Introduction}\label{sec:intro}
We study evidence units \cite{lewis2020rag}.
\input{sections/method}
\section{Conclusion}
See Section~\ref{}. Prior work \cite{missing2024}.

\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;
const methodText = String.raw`\section{Method}\label{sec:method}
\subsection{Index}
Structure completion builds the index.
`;
const bibText = String.raw`@inproceedings{lewis2020rag,
  title = {Retrieval-Augmented Generation for Knowledge-Intensive {NLP} Tasks},
  author = {Lewis, Patrick and Perez, Ethan and Piktus, Aleksandra},
  year = {2020},
  booktitle = {NeurIPS}
}
@misc{unusedEntry, title = {Never Cited}, year = {2019}}
`;
// What doi.org returns for an attention paper, single-line as Crossref sends it.
const fetched =
  "@inproceedings{Vaswani_2017, title={Attention Is All You Need}, author={Vaswani, Ashish and Shazeer, Noam}, booktitle={NeurIPS}, year={2017}, keywords={x}}";

await smoke("writing", async (root) => {
  const folder = path.join(root, "paper");
  await fs.mkdir(path.join(folder, "sections"), { recursive: true });
  await fs.writeFile(path.join(folder, "main.tex"), mainText);
  await fs.writeFile(path.join(folder, "sections", "method.tex"), methodText);
  await fs.writeFile(path.join(folder, "refs.bib"), bibText);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: folder,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Smoke",
        GIT_AUTHOR_EMAIL: "smoke@example.com",
        GIT_COMMITTER_NAME: "Smoke",
        GIT_COMMITTER_EMAIL: "smoke@example.com",
      },
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "Submitted draft");
  const { app, page } = await launchApp();
  // Reference lookups answer locally instead of reaching doi.org.
  await app.evaluate(({ ipcMain }, bibtex) => {
    ipcMain.removeHandler("references:lookup");
    ipcMain.handle("references:lookup", async (_event, input) =>
      input.includes("10.5555") ? { bibtex } : { candidates: [] },
    );
  }, fetched);
  const id = await useProject(page, "Writing Workflow", folder);
  await page.evaluate(async (id) => {
    const workspace = await window.research.load();
    Object.assign(
      workspace.projects.find((p) => p.id === id),
      { pageLimit: 1, anonymousReview: true },
    );
    await window.research.save(workspace);
  }, id);
  await page.reload();
  await page
    .getByRole("button", { name: "Writing Workflow", exact: true })
    .click();
  await page.getByRole("button", { name: "Source + PDF", exact: true }).click();
  await page.locator(".cm-content").waitFor();

  // The outline follows \input into other files, in reading order.
  const outline = page.locator(".outline");
  await outline.locator("summary").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".outline button").length === 4,
  );
  assert.deepEqual(
    await outline
      .locator("button")
      .evaluateAll((buttons) => buttons.map((b) => b.firstChild.textContent)),
    ["Introduction", "Method", "Index", "Conclusion"],
  );
  assert.match(
    await page.locator(".editor-status").innerText(),
    /in manuscript/,
  );

  // Prose is spell-checked; commands, keys and math are not.
  const content = page.locator(".cm-content");
  assert.equal(await content.getAttribute("spellcheck"), "true");
  assert.ok(
    (
      await content
        .locator('[spellcheck="false"]')
        .evaluateAll((spans) => spans.map((s) => s.textContent))
    ).includes("\\cite{lewis2020rag}"),
  );
  await page.getByRole("button", { name: "Spelling on" }).click();
  assert.equal(await content.getAttribute("spellcheck"), "false");
  await page.getByRole("button", { name: "Spelling off" }).click();
  assert.equal(await content.getAttribute("spellcheck"), "true");

  // Hovering a citation key shows its entry.
  await page.getByText("lewis2020rag", { exact: true }).hover();
  const card = page.locator(".cm-citation-card");
  await card.waitFor();
  assert.match(
    await card.innerText(),
    /Retrieval-Augmented Generation .* · Lewis, Perez, Piktus · NeurIPS 2020 — refs\.bib:1/,
  );

  // Bibliography checks run without a compile.
  await page.getByRole("button", { name: /Build log/ }).click();
  const problems = page.locator(".build-problems");
  await problems.waitFor();
  const listed = await problems.innerText();
  assert.match(listed, /Citation 'missing2024' is not in any \.bib file/);
  assert.match(listed, /1 BibTeX entry is never cited: unusedEntry/);

  // \ref offers labels from every manuscript file.
  const conclusion = page.locator(".cm-line", { hasText: "See Section" });
  await conclusion.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < "See Section~\\ref{".length; i++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.type("sec");
  const options = page.locator(".cm-tooltip-autocomplete li");
  await options.first().waitFor();
  assert.deepEqual(
    (await options.allInnerTexts()).map((t) => t.trim()).sort(),
    ["sec:intro", "sec:method"],
  );
  await page.keyboard.press("Escape");

  // \cite completion lists keys with their year.
  await page.keyboard.press("End");
  await page.keyboard.type(" \\cite{lew");
  await options.first().waitFor();
  assert.match(await options.first().innerText(), /lewis2020rag\s*2020/);
  await page.keyboard.press("Escape");
  await page.keyboard.type("}");

  // A DOI becomes a tidy entry in refs.bib and a citation at the cursor.
  await page.keyboard.type(" \\cite{}");
  await page.keyboard.press("ArrowLeft");
  await page
    .getByRole("button", { name: "Add reference", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add reference" });
  await dialog.getByLabel("DOI, arXiv ID or title").fill("10.5555/attention");
  await dialog.getByRole("button", { name: "Find", exact: true }).click();
  const draft = dialog.getByLabel("BibTeX entry");
  await draft.waitFor();
  assert.match(
    await draft.inputValue(),
    /^@inproceedings\{vaswani2017attention,/,
  );
  assert.doesNotMatch(await draft.inputValue(), /keywords/);
  await page.screenshot({
    path: "output/playwright/writing-add-reference.png",
  });
  await dialog.getByRole("button", { name: "Add to refs.bib" }).click();
  await dialog.waitFor({ state: "detached" });
  const saved = await fs.readFile(path.join(folder, "refs.bib"), "utf8");
  assert.match(
    saved,
    /year = \{2019\}\}\n\n@inproceedings\{vaswani2017attention,\n  title     = \{Attention Is All You Need\},/,
  );
  assert.match(await conclusion.innerText(), /\\cite\{vaswani2017attention\}/);
  await page.screenshot({ path: "output/playwright/writing-outline.png" });

  // Opening a section in another file moves the editor there.
  await outline.getByRole("button", { name: /Index/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Don't save", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".cm-content")
      ?.textContent.includes("Structure completion"),
  );
  // A real compile feeds the submission check in the Build log.
  await page.getByRole("button", { name: /^Compile/ }).click();
  await page.getByRole("button", { name: /Build log/ }).click();
  const checks = page.getByRole("list", { name: "Submission check" });
  await checks.waitFor({ timeout: 120000 });
  const report = await checks.innerText();
  assert.match(
    report,
    /The body fits in 1 of 1 pages; references start on page 1/,
  );
  assert.match(report, /All fonts are embedded/);
  assert.match(report, /\\author names the authors/);
  await page.screenshot({
    path: "output/playwright/writing-submission-check.png",
  });
  // A failed check offers to hand the fix to the agent; the user sends it.
  await page
    .getByRole("button", { name: "Ask Agent to fix", exact: true })
    .click();
  assert.match(
    await page.getByLabel("Message the AI agent", { exact: true }).inputValue(),
    /^Fix the problems listed in the Build log/,
  );
  // The agent's check_submission reads the files and PDF on disk through the
  // window and returns the same checks.
  const agentChecks = await app.evaluate(
    async ({ app, BrowserWindow }, projectId) => {
      const requireApp = process
        .getBuiltinModule("node:module")
        .createRequire(app.getAppPath() + "/package.json");
      const { createWindowTools } = requireApp("./electron/window-tools.cjs");
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
        "check_submission",
        {},
        new AbortController().signal,
        60000,
      );
    },
    id,
  );
  const agentReport = agentChecks.checks.map((c) => c.message).join("\n");
  assert.match(agentReport, /The body fits in 1 of 1 pages/);
  assert.match(agentReport, /\\author names the authors/);
  assert.ok(Array.isArray(agentChecks.problems));
  // A build the agent ran shows in the Build log as if the user compiled.
  await app.evaluate(({ BrowserWindow }, projectId) => {
    const send = (event) =>
      BrowserWindow.getAllWindows()[0].webContents.send("latex:agent-build", {
        projectId,
        ...event,
      });
    send({ running: true });
    send({
      running: false,
      ok: false,
      log: "./main.tex:7: Undefined control sequence.\n",
      pdf: null,
    });
  }, id);
  await page.getByRole("button", { name: /Build log/ }).click();
  await page.getByText("Build failed", { exact: false }).waitFor();
  await page
    .locator(".build-problems")
    .first()
    .getByText("Undefined control sequence.")
    .waitFor();
  // ⌘K runs commands; ">" lists only commands.
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("combobox", { name: "Search workspace" });
  await palette.fill(">layout all");
  await page.getByRole("option", { name: /All panels/ }).waitFor();
  await palette.press("Enter");
  await page.locator(".workbench.mode-combined").waitFor({ state: "attached" });
  // The application menu sends the same commands.
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()
      .items.find((menu) => menu.label === "View")
      .submenu.items.find((entry) => entry.label === "Source + PDF");
    item.click();
  });
  await page.locator(".workbench.mode-edit").waitFor({ state: "attached" });

  // Track changes compiles a latexdiff against the commit into its own PDF.
  await page.locator(".cm-line", { hasText: "Structure completion" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Revised for the rebuttal.");
  await page.locator(".git-toggle").click();
  await page.getByRole("button", { name: "Track changes" }).first().click();
  await page.getByText("Changes since", { exact: false }).first().waitFor({
    timeout: 120000,
  });
  const marked = await fs.readFile(
    path.join(folder, ".research-build", "diff", "diff.tex"),
    "utf8",
  );
  assert.match(marked, /\\DIFadd\{Revised/);
  assert.match(
    await fs.readFile(path.join(folder, "sections", "method.tex"), "utf8"),
    /Revised for the rebuttal/,
  );
  await page.screenshot({
    path: "output/playwright/writing-track-changes.png",
  });
  return "Writing workflow passed: manuscript outline and word count across files, cross-file navigation, \\ref labels from every file, \\cite completion and hover cards, bibliography checks without compiling, adding a DOI reference with a citation at the cursor, the submission check after a real compile, a latexdiff PDF against a commit, spell checking that skips LaTeX code, and commands from ⌘K and the application menu.";
});
