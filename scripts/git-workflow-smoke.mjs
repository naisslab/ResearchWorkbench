import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-git-workflow-"));
const folder = path.join(root, "manuscript"),
  remote = path.join(root, "paper.git");
const git = (cwd, ...args) => exec("/usr/bin/git", ["-C", cwd, ...args]);
let desktop;
try {
  await fs.mkdir(folder);
  await fs.mkdir(remote);
  await git(remote, "init", "--bare", "--initial-branch=main");
  await git(folder, "init", "--initial-branch=main");
  await git(folder, "config", "user.name", "Workflow Test");
  await git(folder, "config", "user.email", "workflow@example.com");
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nInitial research draft.\n\\end{document}\n",
  );
  await fs.writeFile(
    path.join(folder, "references.bib"),
    "@article{baseline,\n title={Original study},\n year={2025}\n}\n",
  );
  await git(folder, "add", ".");
  await git(folder, "commit", "-m", "Initial research draft");
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nRevised evaluation and methodology.\n\\end{document}\n",
  );
  await fs.writeFile(
    path.join(folder, "references.bib"),
    "@article{baseline,\n title={Updated study},\n year={2026}\n}\n",
  );
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
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page
    .getByRole("heading", { name: "Research Overview", exact: true })
    .waitFor();
  const id = await page.evaluate(async (folder) => {
    const workspace = await window.research.load();
    const project = workspace.projects[0];
    project.name = "Git Workflow Review";
    project.folder = folder;
    project.localFolders = [];
    project.mainFile = "main.tex";
    workspace.appearance = "light";
    await window.research.save(workspace);
    return project.id;
  }, folder);
  await page.reload();
  await page
    .getByRole("button", { name: "Git Workflow Review", exact: true })
    .click();
  await page.locator(".git-toggle").click();
  await page.locator(".git-progress").waitFor({ state: "hidden" });
  await page
    .getByRole("region", { name: "File diff", exact: true })
    .getByText("+Revised evaluation and methodology.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Select all changes").isChecked(), true);
  await page.getByLabel("Include references.bib in commit").uncheck();
  await page
    .getByLabel("Commit message")
    .fill("Revise the manuscript evaluation");
  await fs.mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/git-workflow-light.png" });
  await page
    .getByRole("button", { name: "Commit changes", exact: true })
    .click();
  await page
    .getByText("Commit saved locally. Push to publish it to your remote.", {
      exact: true,
    })
    .waitFor();
  assert.match(
    (await git(folder, "show", "HEAD:references.bib")).stdout,
    /Original study/,
  );
  assert.match(
    (await git(folder, "show", "HEAD:main.tex")).stdout,
    /Revised evaluation/,
  );
  assert.equal(await page.locator(".git-changes > div").count(), 1);
  await page.getByLabel("Git remote URL").fill(remote);
  await page
    .getByRole("button", { name: "Connect remote", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check remote", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Sync", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Check remote", exact: true }).click();
  await page.getByText("Remote status updated.", { exact: true }).waitFor();
  assert.equal(await page.locator(".git-error").count(), 0);
  await page.getByLabel("Commit message").fill("Update related work citations");
  await page
    .getByRole("button", { name: "Commit changes", exact: true })
    .click();
  await page.getByText("Working tree clean", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await page
    .getByText("Commits pushed to the remote.", { exact: true })
    .waitFor();
  assert.match(
    (await git(remote, "log", "--format=%s")).stdout,
    /Update related work citations/,
  );
  await page.getByTitle("Close Git").click();
  // A failed commit must retain both its error and the user's commit message.
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nUpdated experiment results.\n\\end{document}\n",
  );
  await git(folder, "config", "user.useConfigOnly", "true");
  await git(folder, "config", "user.name", "");
  await git(folder, "config", "user.email", "");
  await page.locator(".git-toggle").click();
  await page.getByLabel("Include main.tex in commit").waitFor();
  await page.getByLabel("Commit message").fill("Save updated results");
  await page
    .getByRole("button", { name: "Commit changes", exact: true })
    .click();
  await page.locator(".git-error").waitFor();
  assert.equal(
    await page.getByLabel("Commit message").inputValue(),
    "Save updated results",
  );
  await page.getByTitle("Close Git").click();
  await page.getByTitle("Switch to dark mode").click();
  await page.locator(".git-toggle").click();
  await page
    .getByRole("region", { name: "File diff" })
    .getByText("+Updated experiment results.", { exact: true })
    .waitFor();
  await page.getByLabel("Commit message").fill("Save updated results");
  await page.screenshot({ path: "output/playwright/git-workflow-dark.png" });
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("dialog", { name: "Git repository" }).count(),
    0,
  );
  assert.equal(
    await page
      .locator(".git-toggle")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(
    (await page.evaluate((id) => window.research.gitStatus(id, "primary"), id))
      .changes.length,
    1,
  );
  assert.deepEqual(failures, []);
  console.log(
    "Git workflow verified: diff review, selected commits, dirty fetch, push, retained errors, light/dark themes, and keyboard dismissal.",
  );
} finally {
  await desktop?.close();
  await fs.rm(root, { recursive: true, force: true });
}
