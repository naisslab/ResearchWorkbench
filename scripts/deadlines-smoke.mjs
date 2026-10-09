import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-dates-ui-"));
const source = JSON.parse(
  await fs.readFile(
    path.join(
      os.homedir(),
      "Library/Application Support/mac-ddl-count/tracker.json",
    ),
    "utf8",
  ),
);
let app;
const errors = [];
async function launch() {
  app = await electron.launch({
    executablePath: process.env.RESEARCH_APP_PATH || undefined,
    args: process.env.RESEARCH_APP_PATH ? [] : ["."],
    cwd: process.cwd(),
    env: { ...process.env, RESEARCH_TEST_DATA: root, RESEARCH_DEV_URL: "" },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("heading", { name: "Research Overview", exact: true })
    .waitFor();
  return page;
}
try {
  try {
    await fs.copyFile(
      "/tmp/research-ccf-live.json",
      path.join(root, "ccf-deadlines-cache.json"),
    );
  } catch {}
  let page = await launch();
  const initial = await page.evaluate(() => window.research.load());
  assert.equal(initial.appearance, "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal(
    await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
    "system",
  );
  const areaProjects = page.locator(".area-projects").first();
  const areaBox = await areaProjects.boundingBox();
  await page.mouse.move(
    areaBox.x + areaBox.width / 2,
    areaBox.y + areaBox.height / 2,
  );
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    () => document.querySelector(".area-projects").dataset.scrolling === "true",
  );
  await page.waitForFunction(
    () => !document.querySelector(".area-projects").dataset.scrolling,
  );
  const sp = initial.trackedDeadlines.find(
    (d) => d.sourceKey === "sp:sp27:1:deadline",
  );
  assert.deepEqual(sp.projectIds.sort(), [
    "research-agent-firewall",
    "research-llm-fingerprints",
    "research-spliceleak",
  ]);
  const osdi = initial.trackedDeadlines.find(
    (d) => d.sourceKey === "osdi:osdi2027:0:deadline",
  );
  assert.deepEqual(osdi.projectIds.sort(), [
    "research-traceforge",
    "research-tracefoundry",
  ]);
  const imported = initial.trackedDeadlines.filter(
    (d) => d.importedFrom === "mac-ddl-count",
  );
  assert.equal(imported.length, source.deadlines.length);
  for (const old of source.deadlines) {
    const next = imported.find((d) => d.id === `mac:${old.id}`);
    assert.ok(next);
    assert.equal(next.time, new Date(old.deadline).toISOString());
    assert.equal(next.status, old.status);
  }
  assert.equal(
    initial.trackedDeadlines.filter((d) => d.eventId === "www27").length,
    4,
  );
  await page.getByRole("button", { name: /Dates & deadlines/ }).click();
  await page.getByRole("tab", { name: /My dates/ }).waitFor();
  await page.getByLabel("Search deadlines").fill("TraceFoundry");
  assert.equal(await page.locator(".tracked-date-row").count(), 2);
  await page
    .getByRole("tab", { name: "Project milestones", exact: true })
    .click();
  const linkedMilestone = page
    .locator(".deadline-table-row")
    .filter({ hasText: "TraceFoundry" })
    .first();
  await linkedMilestone
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByRole("heading", { name: "Edit date", exact: true }).waitFor();
  await page.getByLabel("TraceFoundry", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save date", exact: true }).click();
  const afterEdit = await page.evaluate(() => window.research.load());
  const edited = afterEdit.trackedDeadlines.find(
    (d) =>
      d.id === osdi.id || d.sourceKey === "osdi:osdi2027:0:abstract_deadline",
  );
  assert.equal(
    afterEdit.trackedDeadlines.length,
    initial.trackedDeadlines.length,
  );
  assert.equal(
    afterEdit.trackedDeadlines.filter((d) =>
      d.projectIds?.includes("research-tracefoundry"),
    ).length,
    1,
  );
  await page.getByRole("tab", { name: /My dates/ }).click();
  await page.getByLabel("Search deadlines").fill("");
  await page.screenshot({ path: "output/playwright/deadlines-light.png" });
  await page
    .locator(".tracked-date-row")
    .filter({ hasText: "OSDI 2027 paper" })
    .getByRole("button", { name: /TraceForge/ })
    .click();
  await page
    .locator(".linked-conference-dates")
    .getByText("OSDI 2027 paper", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: /Dates & deadlines/ }).click();
  await page.getByRole("tab", { name: "CCF conferences", exact: true }).click();
  await page.getByLabel("Search CCF conferences").fill("SIGMETRICS");
  await page
    .getByRole("heading", { name: "SIGMETRICS 2027", exact: true })
    .waitFor();
  const winter = page.getByRole("button", {
    name: "Track SIGMETRICS 2027 Abstract winter round",
    exact: true,
  });
  await winter.click();
  await page
    .getByRole("button", {
      name: "Tracked SIGMETRICS 2027 Abstract winter round",
      exact: true,
    })
    .waitFor();
  const afterTrack = await page.evaluate(() => window.research.load());
  assert.equal(
    afterTrack.trackedDeadlines.length,
    initial.trackedDeadlines.length + 1,
  );
  await page.getByLabel("Search CCF conferences").fill("The Web Conference");
  await page
    .getByRole("heading", {
      name: "The Web Conference (WWW) 2027",
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: "output/playwright/ccf-conferences-light.png",
  });
  await page.getByRole("tab", { name: /My dates/ }).click();
  await page
    .getByRole("button", { name: "Import Mac dates", exact: true })
    .click();
  await page
    .getByText("0 new dates imported from mac-ddl-count.", { exact: true })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.research.load())).trackedDeadlines.length,
    afterTrack.trackedDeadlines.length,
  );
  await page.getByRole("button", { name: "Add date", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("UI exact-time milestone");
  await page.getByLabel("Local date and time").fill("2026-12-15T18:30");
  await page.getByLabel("PACC", { exact: true }).check();
  await page.getByLabel("TraceForge", { exact: true }).check();
  await page.getByRole("button", { name: "Save date", exact: true }).click();
  await page
    .getByRole("button", { name: "UI exact-time milestone", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.locator(".toast").waitFor({ state: "hidden" });
  await page.screenshot({ path: "output/playwright/deadlines-dark.png" });
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim(),
    ),
    "#1f1f1f",
  );
  const stored = await page.evaluate(() => window.research.load());
  assert.equal(stored.appearance, "dark");
  const manual = stored.trackedDeadlines.find(
    (d) => d.label === "UI exact-time milestone",
  );
  assert.deepEqual(manual.projectIds.sort(), [
    "research-pacc",
    "research-traceforge",
  ]);
  const manuscript = path.join(root, "manuscript");
  await fs.mkdir(manuscript);
  await fs.writeFile(
    path.join(manuscript, "main.tex"),
    String.raw`% Theme and grammar verification
\documentclass[11pt]{article}
\begin{document}
\section{Introduction}
See \cite{smith2026} and \ref{sec:intro}.
\begin{equation}
E = mc^2 + \alpha
\end{equation}
\end{document}
`,
  );
  await fs.writeFile(
    path.join(manuscript, "references.bib"),
    "@article{smith2026,\n title = {A Research Paper},\n year = {2026}\n}\n",
  );
  await fs.writeFile(
    path.join(manuscript, "analysis.py"),
    "# A comment\ndef evaluate(x):\n    return x + 42\n",
  );
  await fs.writeFile(path.join(manuscript, "config.json"), '{"budget": }\n');
  await page.evaluate(async (folder) => {
    const state = await window.research.load();
    state.projects.push({
      id: "date-theme-test",
      areaId: "ml",
      name: "Dark Editor Test",
      summary: "Temporary theme verification",
      stage: "writing",
      folder,
      mainFile: "main.tex",
      sshHost: "",
      venue: "",
      notes: "",
      tasks: [],
      deadlines: [],
      updatedAt: new Date().toISOString(),
    });
    await window.research.save(state);
  }, manuscript);
  await app.close();
  app = undefined;
  page = await launch();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page
    .getByRole("button", { name: "Dark Editor Test", exact: true })
    .click();
  await page.locator(".cm-editor").waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".cm-editor")).backgroundColor ===
      "rgb(31, 31, 31)",
  );
  await page
    .locator(".terminal-status")
    .getByText("Connected", { exact: true })
    .waitFor();
  await page.locator(".cm-content .syn-keyword").first().waitFor();
  await page.locator(".cm-content .syn-reference").first().waitFor();
  await page.locator(".cm-content .syn-heading").first().waitFor();
  await page.locator(".cm-content .syn-number").first().waitFor();
  const syntaxColors = await page
    .locator('.cm-content span[class*="syn-"]')
    .evaluateAll((elements) => [
      ...new Set(elements.map((element) => getComputedStyle(element).color)),
    ]);
  assert.ok(
    syntaxColors.length >= 7,
    `Expected rich manuscript highlighting, saw ${syntaxColors.length} colors`,
  );
  await page.screenshot({ path: "output/playwright/workbench-dark.png" });
  await page
    .getByRole("button", { name: "references.bib", exact: true })
    .click();
  await page
    .locator(".editor-language")
    .getByText("BibTeX", { exact: true })
    .waitFor();
  await page.locator('.cm-content span[class*="syn-"]').first().waitFor();
  await page.getByRole("button", { name: "analysis.py", exact: true }).click();
  await page
    .locator(".editor-language")
    .getByText("Python", { exact: true })
    .waitFor();
  assert.ok((await page.locator(".cm-content span").count()) > 2);
  await page.getByRole("button", { name: "config.json", exact: true }).click();
  await page.locator(".cm-lint-marker-error").first().waitFor();
  await page
    .getByRole("button", { name: "main.tex entry", exact: true })
    .click();
  await page.locator(".syn-reference").first().waitFor();
  const final = await page.evaluate(() => window.research.load());
  assert.equal(
    final.trackedDeadlines.length,
    afterTrack.trackedDeadlines.length + 1,
  );
  assert.equal(final.appearance, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${imported.length} Mac deadlines preserved; WWW dates, CCF tracking, duplicate-safe import, exact-time edits, dark editor/terminal and restart persistence.`,
  );
} finally {
  await app?.close();
  await fs.rm(root, { recursive: true, force: true });
}
