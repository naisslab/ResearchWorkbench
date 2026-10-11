const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/core.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { manuscriptWorkspace } = require("./fixtures.cjs");

test("a saved order comes first and items never ordered keep their order after it", async () => {
  const { applyOrder, moveId } = await import("../src/reorder.ts");
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(
    applyOrder(items, (item) => item.id, ["c", "gone", "a"]).map((i) => i.id),
    ["c", "a", "b", "d"],
  );
  assert.deepEqual(
    applyOrder(items, (item) => item.id).map((i) => i.id),
    ["a", "b", "c", "d"],
  );
  const ids = ["a", "b", "c", "d"];
  // Forward lands after the target, back lands before it.
  assert.deepEqual(moveId(ids, "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(moveId(ids, "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveId(ids, "d", "b", true), ["a", "b", "d", "c"]);
  assert.deepEqual(moveId(ids, "a", "a"), ids);
  assert.deepEqual(moveId(ids, "x", "a"), ids);
});

test("saved orders are validated with the workspace", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-order-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = await manuscriptWorkspace(root);
  core.validateState({
    ...workspace,
    projectOrder: [workspace.projects[0].id],
    collectionOrder: ["catalog-1"],
  });
  for (const bad of [{ projectOrder: "a" }, { collectionOrder: ["", "b"] }])
    assert.throws(
      () => core.validateState({ ...workspace, ...bad }),
      /saved order/,
    );
});
