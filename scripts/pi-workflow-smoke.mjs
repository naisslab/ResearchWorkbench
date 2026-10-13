import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { smoke, launchApp, stubDialogs } from "./smoke-harness.mjs";

const execute = promisify(execFile);
await smoke("pi-workflow", async (root) => {
  const folder = path.join(root, "manuscript");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\begin{document}A research manuscript.\\end{document}\n",
  );
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.name", "Fixture Researcher"],
    ["config", "user.email", "researcher@example.test"],
    ["add", "main.tex"],
    ["commit", "-m", "Manuscript for review"],
  ])
    await execute("git", args, { cwd: folder });
  const revision = (
    await execute("git", ["rev-parse", "HEAD"], { cwd: folder })
  ).stdout.trim();
  const { app, page } = await launchApp({ demoData: false });
  const id = await page.evaluate(
    async ({ folder }) => {
      const state = await window.research.load();
      const project = {
        id: "pi-paper",
        name: "PI workflow paper",
        areaId: state.areas[0].id,
        summary: "Review a manuscript",
        stage: "writing",
        folder,
        mainFile: "main.tex",
        sshHost: "",
        venue: "",
        notes: "Shareable notes",
        tasks: [{ id: "baseline", text: "Validate baseline", done: false }],
        deadlines: [
          {
            id: "draft",
            label: "Draft ready",
            date: "2026-11-01",
            kind: "other",
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      state.projects = [project];
      await window.research.save(state);
      localStorage.setItem(
        "research-workbench.navigation",
        JSON.stringify({ view: "details", projectId: project.id, area: "all" }),
      );
      return project.id;
    },
    { folder },
  );
  await page.reload();
  const saved = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await page.evaluate(() => window.research.load());
      const project = state.projects.find((item) => item.id === id);
      if (predicate(project)) return project;
      await page.waitForTimeout(50);
    }
    throw new Error("PI metadata did not reach persistent state");
  };
  await page
    .getByLabel("Project owner or lead", { exact: true })
    .fill("Alex Researcher");
  await page.getByLabel("Project owner or lead", { exact: true }).press("Tab");
  await page
    .getByLabel("Assignee for Validate baseline", { exact: true })
    .fill("Sam Student");
  await page
    .getByLabel("Assignee for Validate baseline", { exact: true })
    .press("Tab");
  await page
    .getByLabel("Due date for Validate baseline", { exact: true })
    .fill("2026-11-02");
  await saved(
    (project) =>
      project.owner === "Alex Researcher" &&
      project.tasks[0].assignee === "Sam Student" &&
      project.tasks[0].dueDate === "2026-11-02",
  );
  await page
    .getByLabel("Manuscript revision for review", { exact: true })
    .selectOption(revision);
  await page
    .getByLabel("Request a review", { exact: true })
    .fill("Review evaluation claims");
  await page
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await saved((project) => project.reviewRequests?.[0]?.revision === revision);
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await saved((project) => project.reviewRequests?.[0]?.status === "in-review");
  await page
    .getByLabel("Record a decision", { exact: true })
    .fill("Add the ablation before submission.");
  await page
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await saved((project) => project.decisions?.[0]?.revision === revision);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("region", { name: "PI review inbox" }).waitFor();
  assert.match(
    await page.locator(".portfolio-inbox").innerText(),
    /Alex Researcher/,
  );
  assert.match(
    await page.locator(".portfolio-inbox").innerText(),
    /Review evaluation claims/,
  );
  await page.locator(".portfolio-row").click();
  await page
    .getByRole("button", {
      name: `Mark reviewed at ${revision.slice(0, 8)}`,
      exact: true,
    })
    .click();
  const reviewed = await saved(
    (project) =>
      project.lastReviewedCommit === revision &&
      project.reviewRequests?.[0]?.status === "reviewed",
  );
  assert.equal(reviewed.reviewRequests[0].reviewedRevision, revision);
  assert.ok(reviewed.reviewRequests[0].reviewedAt);
  assert.ok(reviewed.lastSubstantiveUpdate);
  const manifestFile = path.join(root, "project.research.json");
  await stubDialogs(app, { save: manifestFile });
  await page
    .getByRole("button", { name: "Export project manifest…", exact: true })
    .click();
  await page.getByText("Project metadata exported.", { exact: true }).waitFor();
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  assert.equal(manifest.project.lastReviewedCommit, revision);
  assert.equal(manifest.project.folder, undefined);
  const calendarFile = path.join(root, "calendar.ics");
  await stubDialogs(app, { save: calendarFile });
  await page
    .getByRole("button", { name: "Export project calendar…", exact: true })
    .click();
  await page
    .getByText(
      "Calendar exported. Import the .ics file into your calendar app.",
      { exact: true },
    )
    .waitFor();
  assert.match(
    await fs.readFile(calendarFile, "utf8"),
    /DTSTART;VALUE=DATE:20261102/,
  );
  await page.screenshot({ path: "output/playwright/pi-workflow-details.png" });

  // Visiting projects should not start hidden shells or retain every editor.
  await page.evaluate(async () => {
    const state = await window.research.load();
    const template = state.projects[0];
    state.projects.push(
      ...Array.from({ length: 8 }, (_, i) => ({
        ...template,
        id: `cache-${i}`,
        name: `Cache paper ${i}`,
        folder: "",
        mainFile: "",
        tasks: [],
        deadlines: [],
        reviewRequests: [],
        decisions: [],
      })),
    );
    await window.research.save(state);
  });
  await page.reload();
  for (let index = 0; index < 8; index++) {
    await page
      .locator(".sidebar")
      .getByRole("button", { name: `Cache paper ${index}`, exact: true })
      .click();
    await page
      .locator(`[data-project-id="cache-${index}"] .workbench`)
      .waitFor();
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".project-workbench").length <= 7,
  );
  assert.equal(await page.locator(".terminal-panel").count(), 0);
  await page.getByRole("button", { name: "Overleaf", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Connect Overleaf/);
  return "PI owner/tasks, revision-linked review/decision, inbox, metadata/calendar export, bounded idle views and on-demand terminals passed.";
});
