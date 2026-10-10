import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Synthetic mac-ddl-count data, dated far ahead so the fixture never expires.
export const macDdlDir = fileURLToPath(
  new URL("../tests/fixtures/mac-ddl-count", import.meta.url),
);
let root, app, page;
const errors = [];

export async function launchApp() {
  app = await electron.launch({
    executablePath: process.env.RESEARCH_APP_PATH || undefined,
    args: process.env.RESEARCH_APP_PATH ? [] : ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      RESEARCH_TEST_DATA: path.join(root, "user-data"),
      RESEARCH_DEV_URL: "",
      RESEARCH_MAC_DDL_DIR: macDdlDir,
    },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "Research Overview", exact: true })
    .waitFor();
  return { app, page };
}

export const stubDialogs = (app, paths) =>
  app.evaluate(({ dialog }, { open, save }) => {
    if (open)
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [open],
      });
    if (save)
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: save });
  }, paths);

// Turns the first seeded project into a light-theme project on `folder`.
export async function useProject(page, name, folder) {
  const id = await page.evaluate(
    async ({ name, folder }) => {
      const workspace = await window.research.load();
      const project = workspace.projects[0];
      Object.assign(project, {
        name,
        folder,
        localFolders: [],
        mainFile: "main.tex",
      });
      workspace.appearance = "light";
      await window.research.save(workspace);
      return project.id;
    },
    { name, folder },
  );
  await page.reload();
  return id;
}

// Runs `body` in a temporary root and prints the summary it returns once no
// uncaught page errors remain.
export async function smoke(name, body) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), `research-${name}-`));
  await fs.mkdir("output/playwright", { recursive: true });
  try {
    const summary = await body(root);
    assert.deepEqual(errors, []);
    console.log(summary);
  } catch (error) {
    console.error(
      "UI ERROR:",
      await page
        ?.locator("body")
        .innerText()
        .catch(() => ""),
    );
    await page
      ?.screenshot({ path: `output/playwright/${name}-failure.png` })
      .catch(() => {});
    throw error;
  } finally {
    await app?.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}
