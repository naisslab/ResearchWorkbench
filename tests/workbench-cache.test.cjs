const { test } = require("node:test");
const assert = require("node:assert/strict");

test("workbench cache evicts only older idle views and keeps active work", async () => {
  const { retainedWorkbenches } = await import("../src/workbench-cache.ts");
  const projects = Array.from({ length: 12 }, (_, index) => `paper-${index}`);
  const protectedIds = new Set(["paper-0", "paper-2", "paper-3"]);
  const kept = retainedWorkbenches(projects, "paper-1", protectedIds);
  assert.deepEqual(kept, [
    "paper-0",
    "paper-1",
    "paper-2",
    "paper-3",
    ...projects.slice(-6),
  ]);
  assert.deepEqual(
    retainedWorkbenches(projects, "paper-11", new Set()),
    projects.slice(-7),
  );
  assert.deepEqual(
    retainedWorkbenches(projects, "", new Set()),
    projects.slice(-6),
  );
  assert.deepEqual(
    retainedWorkbenches(["paper", "paper"], "paper", new Set()),
    ["paper"],
  );
  assert.deepEqual(retainedWorkbenches(projects, "paper-0", new Set(), 0), [
    "paper-0",
  ]);
});
