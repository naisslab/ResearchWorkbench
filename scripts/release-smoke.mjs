import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { smoke, launchApp, stubDialogs, closeApp } from "./smoke-harness.mjs";
const execute = promisify(execFile);
const git = (cwd, ...args) => execute("git", args, { cwd });
await smoke("release", async (root) => {
  const dataDirectory = path.join(root, "data");
  let { app, page } = await launchApp({ dataDirectory, demoData: false });
  const fresh = await page.evaluate(() => window.research.load());
  assert.equal(fresh.projects.length, 0);
  assert.equal(fresh.areas.length, 1);
  assert.equal(
    (await page.evaluate(() => window.research.researchCatalog())).candidates
      .length,
    0,
  );
  await page
    .getByRole("button", { name: "Try an example" })
    .click({ trial: true });
  await stubDialogs(app, { open: root });
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.waitForFunction(
    async () => (await window.research.load()).projects.length === 1,
  );
  const example = (await page.evaluate(() => window.research.load()))
    .projects[0];
  assert.ok(
    (await fs.readFile(path.join(example.folder, "main.tex"), "utf8")).includes(
      "Example",
    ),
  );
  const diagnostics = await page.evaluate(() =>
    window.research.setupDiagnostics(),
  );
  assert.ok(diagnostics.some((tool) => tool.id === "git" && tool.available));
  assert.ok(diagnostics.some((tool) => tool.id === "latexmk"));
  const manifestPath = path.join(root, "example.research.json");
  await stubDialogs(app, { save: manifestPath });
  assert.equal(
    await page.evaluate((id) => window.research.exportProject(id), example.id),
    true,
  );
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.ok(!JSON.stringify(manifest).includes(example.folder));
  await page.screenshot({ path: "output/playwright/release-example.png" });
  if (process.env.RESEARCH_APP_PATH)
    return "Packaged fresh-install, example, diagnostics and metadata export passed.";
  await closeApp();

  // Test-only bootstrap injects a local Git transport and a synthetic encrypted
  // store before the production main module starts. No test bypass ships in app.
  const remote = path.join(root, "remote.git"),
    peer = path.join(root, "peer"),
    clone = path.join(root, "clone");
  await git(root, "init", "--bare", "--initial-branch=main", remote);
  await fs.mkdir(peer);
  await git(peer, "init", "--initial-branch=main");
  await git(peer, "config", "user.name", "Test Coauthor");
  await git(peer, "config", "user.email", "coauthor@example.test");
  await fs.writeFile(
    path.join(peer, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nTest manuscript.\n\\end{document}\n",
  );
  await git(peer, "add", "main.tex");
  await git(peer, "commit", "-m", "Initial source");
  await git(peer, "remote", "add", "origin", remote);
  await git(peer, "push", "-u", "origin", "main");
  const bootstrap = path.join(root, "bootstrap.cjs");
  await fs.writeFile(
    bootstrap,
    `const moduleApi = require(${JSON.stringify(path.resolve("electron/overleaf.cjs"))});
const create = moduleApi.createOverleaf;
moduleApi.createOverleaf = (options) => create({...options,
 encryption: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s.split('').reverse().join('')), decryptString: (b) => b.toString().split('').reverse().join('') },
 transport: ({folder,args,connection,git,options}) => git.run(folder,args.map(a=>a===connection.gitUrl?${JSON.stringify(remote)}:a),[],{},options)
});
require(${JSON.stringify(path.resolve("electron/main.cjs"))});\n`,
  );
  ({ app, page } = await launchApp({
    dataDirectory: path.join(root, "overleaf-data"),
    demoData: false,
    entry: bootstrap,
  }));
  await stubDialogs(app, { save: clone });
  await page
    .getByRole("button", { name: "Connect Overleaf", exact: true })
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Collaborative manuscript");
  await page
    .getByLabel("Overleaf project URL", { exact: true })
    .fill("https://www.overleaf.com/project/0123456789abcdef01234567");
  await page
    .getByLabel("Git authentication token", { exact: true })
    .fill("synthetic-overleaf-token");
  await page
    .getByRole("combobox", { name: /Connection mode/ })
    .selectOption("publish");
  await page
    .getByRole("button", { name: "Choose folder and clone", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check coauthor changes", exact: true })
    .waitFor();
  const id = (await page.evaluate(() => window.research.load())).projects[0].id;
  await git(clone, "config", "user.name", "Test Researcher");
  await git(clone, "config", "user.email", "researcher@example.test");
  await fs.writeFile(path.join(clone, "notes.txt"), "Local contribution\n");
  await git(clone, "add", "notes.txt");
  await git(clone, "commit", "-m", "Local notes");
  await fs.writeFile(path.join(peer, "coauthor.txt"), "Remote contribution\n");
  await git(peer, "add", "coauthor.txt");
  await git(peer, "commit", "-m", "Coauthor notes");
  await git(peer, "push");
  await page
    .getByRole("button", { name: "Check coauthor changes", exact: true })
    .click();
  const originalSource = await fs.readFile(
    path.join(clone, "main.tex"),
    "utf8",
  );
  await page.evaluate(
    ({ id, base }) =>
      window.research.writeDraft(id, "main.tex", "primary", {
        text: base + "% unsaved",
        base,
      }),
    { id, base: originalSource },
  );
  await page
    .getByRole("button", {
      name: "Review incoming and local changes",
      exact: true,
    })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Save or discard the editor drafts" })
    .waitFor();
  assert.equal(
    await fs.readFile(path.join(clone, "main.tex"), "utf8"),
    originalSource,
  );
  await page.evaluate(
    (id) => window.research.writeDraft(id, "main.tex", "primary", null),
    id,
  );
  await page
    .getByRole("button", {
      name: "Review incoming and local changes",
      exact: true,
    })
    .click();
  await page.getByText("Source review · ready", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Compile review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open reviewed PDF", exact: true })
    .waitFor({ timeout: 60000 });
  await app.evaluate(({ shell }) => {
    shell.openPath = async (file) => {
      globalThis.__reviewedPdf = file;
      return "";
    };
  });
  await page
    .getByRole("button", { name: "Open reviewed PDF", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply reviewed source locally", exact: true })
    .click({ trial: true });
  const preview = await app.evaluate(() => globalThis.__reviewedPdf);
  assert.ok(preview.includes(`${path.sep}reviews${path.sep}`));
  assert.equal((await fs.readFile(preview)).subarray(0, 4).toString(), "%PDF");
  await page
    .getByRole("button", { name: "Apply reviewed source locally", exact: true })
    .click();
  await page.getByText("Source review · applied", { exact: true }).waitFor();
  assert.equal(
    await fs.readFile(path.join(clone, "coauthor.txt"), "utf8"),
    "Remote contribution\n",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Publish reviewed source", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("checkbox", { name: /I reviewed the source and PDF/ })
    .check();
  await page
    .getByRole("button", { name: "Publish reviewed source", exact: true })
    .click();
  await page.getByText("Source review · published", { exact: true }).waitFor();
  const final = await page.evaluate(
    (id) => window.research.overleafStatus(id),
    id,
  );
  assert.equal(final.head, final.remoteHead);
  assert.ok(
    !JSON.stringify(await page.evaluate(() => window.research.load())).includes(
      "synthetic-overleaf-token",
    ),
  );
  assert.equal(
    (await git(root, "--git-dir", remote, "show", "main:notes.txt")).stdout,
    "Local contribution\n",
  );
  await page.screenshot({ path: "output/playwright/release-overleaf.png" });
  return "Fresh install, example, diagnostics, portable metadata, and local-fixture Overleaf clone/check/review/compile/apply/publish passed.";
});
