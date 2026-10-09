const { test } = require("node:test");
const assert = require("node:assert/strict");
const { migrateAreaLabels } = require("../electron/area-labels.cjs");

test("area upgrade preserves projects, custom names, colors, and catalog metadata", () => {
  const original = {
    version: 1,
    areas: [
      { id: "ml", name: "ML for Systems", color: "#75a6d9", icon: "layers" },
      { id: "security", name: "Security", color: "#b89875", icon: "shield" },
      {
        id: "cps",
        name: "Cyber-Physical Systems",
        color: "#8e95bc",
        icon: "network",
      },
      { id: "custom", name: "My research", color: "#123456", icon: "layers" },
    ],
    projects: [
      {
        id: "existing",
        areaId: "ml",
        notes: "Keep my notes",
        catalogId: "flowwise",
      },
    ],
  };
  const next = migrateAreaLabels(original);
  assert.deepEqual(
    next.areas.map((a) => a.name),
    [
      "ML Systems",
      "Security and Privacy",
      "Cyber-Physical Systems",
      "My research",
    ],
  );
  assert.equal(next.projects, original.projects);
  assert.equal(next.areas[3], original.areas[3]);
  assert.equal(original.areas[0].name, "ML for Systems");
  next.areas[0].name = "User renamed area";
  assert.equal(migrateAreaLabels(next), next);
  const custom = {
    ...original,
    areas: [{ id: "ml", name: "Personal MLSys", color: "#123456" }],
  };
  assert.deepEqual(migrateAreaLabels(custom).areas, custom.areas);
});

test("full names replace the previous short labels in an upgraded workspace", () => {
  const previous = {
    areaLabelVersion: 1,
    projects: [],
    areas: [
      { id: "ml", name: "MLSys", color: "#087cba" },
      { id: "security", name: "Security&Privacy", color: "#ab6f05" },
      { id: "cps", name: "CPS", color: "#a04a95" },
    ],
  };
  const next = migrateAreaLabels(previous);
  assert.deepEqual(
    next.areas.map((area) => area.name),
    ["ML Systems", "Security and Privacy", "Cyber-Physical Systems"],
  );
  assert.equal(next.areaLabelVersion, 2);
  assert.equal(next.projects, previous.projects);
});
