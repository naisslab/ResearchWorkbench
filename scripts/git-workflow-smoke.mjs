import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launchApp, smoke, useProject } from "./smoke-harness.mjs";
const exec = promisify(execFile);
const git = (cwd, ...args) => exec("/usr/bin/git", ["-C", cwd, ...args]);
const gitDialog = (page) =>
  page.getByRole("dialog", { name: "Source control" });
await smoke("git-workflow", async (root) => {
  const folder = path.join(root, "manuscript"),
    remote = path.join(root, "paper.git"),
    peer = path.join(root, "peer");
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
  const { page } = await launchApp();
  const id = await useProject(page, "Git Workflow Review", folder);
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
    false,
  );
  await page.getByRole("button", { name: "Check remote", exact: true }).click();
  await page.getByText("Remote status updated.", { exact: true }).waitFor();
  assert.equal(await page.locator(".git-error").count(), 0);
  // Publish the selected manuscript commit while bibliography edits stay local.
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await page
    .getByText("Commits pushed to the remote.", { exact: true })
    .waitFor();
  assert.match(
    (await git(remote, "show", "main:references.bib")).stdout,
    /Original study/,
  );
  assert.match(
    await fs.readFile(path.join(folder, "references.bib"), "utf8"),
    /Updated study/,
  );
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
  // Pull and Sync each bring in a peer commit and refresh the open editor.
  await git(root, "clone", remote, peer);
  await git(peer, "config", "user.name", "Peer");
  await git(peer, "config", "user.email", "peer@example.com");
  for (const [button, notice] of [
    ["Pull", "Remote changes pulled."],
    ["Sync", "Repository synchronized."],
  ]) {
    const line = `% ${button} from a peer`;
    await fs.appendFile(path.join(peer, "main.tex"), `${line}\n`);
    await git(peer, "commit", "-am", line);
    await git(peer, "push");
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByText(notice, { exact: true }).waitFor();
    assert.ok((await page.locator(".cm-content").innerText()).includes(line));
  }
  await gitDialog(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Open local terminal", exact: true })
    .click();
  await page.locator(".xterm").waitFor({ state: "visible" });
  assert.equal(await gitDialog(page).count(), 0);
  await page.getByTitle("Switch to dark mode").click();
  await page.locator(".git-toggle").click();
  await page
    .getByRole("region", { name: "File diff" })
    .getByText("+Updated experiment results.", { exact: true })
    .waitFor();
  await page.getByLabel("Commit message").fill("Save updated results");
  await page.screenshot({ path: "output/playwright/git-workflow-dark.png" });
  await page.keyboard.press("Escape");
  assert.equal(await gitDialog(page).count(), 0);
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
  return "Git workflow verified: diff review, selected commits, dirty fetch, push, pull and sync with editor refresh, retained errors, light/dark themes, and keyboard dismissal.";
});
