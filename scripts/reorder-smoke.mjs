import assert from "node:assert/strict";
import { launchApp, smoke, closeApp } from "./smoke-harness.mjs";

await smoke("reorder", async () => {
  let { page } = await launchApp();
  const areas = await page.evaluate(async () => {
    const state = await window.research.load();
    const [first, second] = state.areas;
    const project = (name, areaId) => ({
      ...state.projects[0],
      id: `reorder-${name.toLowerCase()}`,
      name,
      areaId,
      stage: "writing",
      deadlines: [],
      tasks: [],
    });
    await window.research.save({
      ...state,
      projects: [
        project("Alpha", first.id),
        project("Beta", first.id),
        project("Gamma", first.id),
        project("Delta", second.id),
      ],
    });
    return [first.name, second.name];
  });
  await page.reload();
  const group = (area) =>
    page
      .locator(".area-group")
      .filter({ has: page.getByRole("button", { name: area, exact: true }) });
  const row = (name) =>
    page.locator(".area-projects").getByRole("button", { name, exact: true });
  const names = (area) =>
    group(area).locator(".area-projects .project-name").allInnerTexts();
  const areaNames = () =>
    page
      .locator(".area-row .area-name")
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute("aria-label")),
      );
  const settle = (area, expected) =>
    page.waitForFunction(
      ([area, expected]) =>
        [
          ...[...document.querySelectorAll(".area-group")]
            .find((g) => g.querySelector(`[aria-label="${area}"]`))
            .querySelectorAll(".area-projects .project-name"),
        ]
          .map((n) => n.textContent)
          .join() === expected.join(),
      [area, expected],
    );
  assert.deepEqual(await names(areas[0]), ["Alpha", "Beta", "Gamma"]);
  // Dragging back lands before the target; Alt+↓ moves one step down.
  await row("Gamma").dragTo(row("Alpha"));
  await settle(areas[0], ["Gamma", "Alpha", "Beta"]);
  await row("Gamma").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await settle(areas[0], ["Alpha", "Gamma", "Beta"]);
  // A project dropped among another area's projects joins that area, undoably.
  await row("Delta").dragTo(row("Beta"));
  await settle(areas[0], ["Alpha", "Gamma", "Delta", "Beta"]);
  await page.getByText(`Moved Delta to ${areas[0]}`).waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settle(areas[0], ["Alpha", "Gamma", "Beta"]);
  assert.deepEqual(await names(areas[1]), ["Delta"]);
  // Dropped on an area's heading, it goes to the end of that area.
  await row("Alpha").dragTo(group(areas[1]).locator(".area-row"));
  await settle(areas[1], ["Delta", "Alpha"]);
  // Areas reorder by their headings.
  await group(areas[1])
    .locator(".area-row")
    .dragTo(group(areas[0]).locator(".area-row"));
  await page.waitForFunction(
    (first) =>
      document
        .querySelector(".area-row .area-name")
        ?.getAttribute("aria-label") === first,
    areas[1],
  );
  // Collection cards reorder within their area.
  await page
    .locator(".main-nav")
    .getByRole("button", { name: "Research collection", exact: true })
    .click();
  const cards = () =>
    page.locator(".collection-area").first().locator(".collection-card h3");
  await cards().first().waitFor();
  const before = await cards().allInnerTexts();
  await page
    .locator(".collection-area")
    .first()
    .locator(".collection-card")
    .nth(2)
    .dragTo(
      page
        .locator(".collection-area")
        .first()
        .locator(".collection-card")
        .first(),
    );
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".collection-area .collection-card h3")
        ?.textContent === expected,
    before[2],
  );
  const collection = await cards().allInnerTexts();
  assert.deepEqual(collection.slice(0, 3), [before[2], before[0], before[1]]);
  await page.waitForTimeout(500);
  await closeApp();
  ({ page } = await launchApp());
  assert.deepEqual(await areaNames().then((list) => list.slice(0, 2)), [
    areas[1],
    areas[0],
  ]);
  assert.deepEqual(await names(areas[0]), ["Gamma", "Beta"]);
  assert.deepEqual(await names(areas[1]), ["Delta", "Alpha"]);
  await page
    .locator(".main-nav")
    .getByRole("button", { name: "Research collection", exact: true })
    .click();
  await cards().first().waitFor();
  assert.deepEqual(
    (await cards().allInnerTexts()).slice(0, 3),
    collection.slice(0, 3),
  );
  await page.screenshot({ path: "output/playwright/reorder.png" });
  return "Reorder UI passed: sidebar projects by drag and Alt+arrow, moves between areas with Undo, area headings, Research collection cards, and restart persistence.";
});
