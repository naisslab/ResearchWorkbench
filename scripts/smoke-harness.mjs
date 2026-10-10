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

export async function launchApp({
  dataDirectory = path.join(root, "user-data"),
} = {}) {
  app = await electron.launch({
    executablePath: process.env.RESEARCH_APP_PATH || undefined,
    args: process.env.RESEARCH_APP_PATH ? [] : ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      RESEARCH_TEST_DATA: dataDirectory,
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

// Fixture data has already been saved when a test requests a restart. An
// unsaved scratch buffer must not leave a native close dialog waiting for input.
export async function closeApp() {
  await app?.evaluate(({ app }) => app.exit()).catch(() => {});
  await app?.close().catch(() => {});
}

export async function dragDivider(page, name, dx, dy = 0) {
  const divider = page.getByRole("separator", { name, exact: true });
  const box = await divider.boundingBox();
  assert.ok(box, `Missing divider: ${name}`);
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.locator(".drag-shield").waitFor({ state: "attached" });
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  // Shield removal confirms that React has rendered the final drag value.
  await page.locator(".drag-shield").waitFor({ state: "detached" });
  return Number(await divider.getAttribute("aria-valuenow"));
}

export async function resizeWindow(app, page, width, height) {
  await app.evaluate(
    ({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height);
    },
    { width, height },
  );
  await page.waitForFunction((width) => innerWidth === width, width);
  // ResizeObserver and React need to finish before reading fitted pane sizes.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

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
    console.error(error);
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
    await closeApp();
    await fs.rm(root, { recursive: true, force: true });
  }
}
