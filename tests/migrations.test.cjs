const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  migrateAreaLabels,
  applySubmissionPlans,
  defaultToSystemAppearance,
  runMigrations,
} = require("../electron/migrations.cjs");
const {
  researchCatalog,
  activateCurrentResearch,
} = require("../electron/catalog.cjs");
const {
  DEFAULT_AREAS,
  seedWorkspace,
  validateState,
} = require("../electron/core.cjs");

test("a new workspace is upgraded once, after which no data source is read", async () => {
  const catalog = await researchCatalog("/tmp/no-research-folders");
  let reads = 0;
  const sources = {
    catalog: async () => (reads++, catalog),
    tracker: async () => (reads++, { deadlines: [] }),
    feed: async () => (reads++, { conferences: [] }),
  };
  const first = await runMigrations(seedWorkspace(), sources);
  assert.equal(reads, 3);
  assert.equal(first.projects.length, 25);
  assert.equal(first.appearance, "system");
  assert.deepEqual(
    first.trackedDeadlines.map((d) => d.projectIds),
    Array(4).fill(["research-web-rag"]),
  );
  reads = 0;
  assert.equal(await runMigrations(first, sources), first);
  assert.equal(reads, 0);
});
test("confirmed submission plans link shared dates, preserve exact times and remain editable after migration", async () => {
  const catalog = await researchCatalog("/tmp/no-research-folders");
  const base = activateCurrentResearch(
    { version: 1, areas: DEFAULT_AREAS, projects: [], trackedDeadlines: [] },
    catalog,
  );
  const keys = [
    "sigmetrics:sigmetrics27:1:deadline",
    "www:www27:0:abstract_deadline",
    "sp:sp27:1:deadline",
    "icde:icde27:1:deadline",
    "osdi:osdi2027:0:deadline",
    "uss:uss27:0:deadline",
    "sp:sp27:0:deadline",
  ];
  base.trackedDeadlines = keys.map((sourceKey, i) => ({
    id: "date" + i,
    label: "Conference " + i,
    subtitle: "",
    category: "paper",
    kind: "submission",
    time: "2026-12-01T22:59:59.000Z",
    timezone: "AoE",
    status: "notStarted",
    source: "ccfddl",
    sourceKey,
  }));
  base.trackedDeadlines[4].projectId = "research-pacc";
  const next = validateState(applySubmissionPlans(base, catalog));
  assert.equal(next.projects.length, 25);
  const date = (key) => next.trackedDeadlines.find((d) => d.sourceKey === key);
  assert.deepEqual(date(keys[2]).projectIds.sort(), [
    "research-agent-firewall",
    "research-llm-fingerprints",
    "research-spliceleak",
  ]);
  assert.deepEqual(date(keys[4]).projectIds.sort(), [
    "research-pacc",
    "research-traceforge",
    "research-tracefoundry",
  ]);
  assert.equal(date(keys[5]).projectIds, undefined);
  assert.equal(date(keys[6]).projectIds, undefined);
  assert.equal(next.trackedDeadlines.length, base.trackedDeadlines.length);
  assert.deepEqual(
    next.trackedDeadlines.map((d) => d.time),
    base.trackedDeadlines.map((d) => d.time),
  );
  assert.equal(
    next.projects.find((p) => p.catalogId === "rag-serving").venue,
    "ACM Computing Surveys",
  );
  assert.equal(
    next.projects.find((p) => p.catalogId === "agent-telemetry").venue,
    "",
  );
  assert.equal(
    next.projects.find((p) => p.catalogId === "spliceleak").stage,
    "revision",
  );
  next.projects.find((p) => p.catalogId === "tracefoundry").venue =
    "Custom target";
  next.trackedDeadlines[4].projectIds = [];
  assert.equal(applySubmissionPlans(next, catalog), next);
});
test("system appearance is selected once; later manual choices survive restart", () => {
  const state = defaultToSystemAppearance({ appearance: "light" });
  assert.equal(state.appearance, "system");
  state.appearance = "dark";
  assert.equal(defaultToSystemAppearance(state), state);
});
test("linked-date validation rejects malformed and duplicate project references", () => {
  const base = {
    version: 1,
    areas: DEFAULT_AREAS,
    projects: [],
    trackedDeadlines: [
      {
        id: "test",
        label: "Conference",
        subtitle: "",
        category: "paper",
        kind: "submission",
        time: "2026-12-01T22:59:59.000Z",
        timezone: "AoE",
        status: "notStarted",
        source: "manual",
        projectIds: ["a", "a"],
      },
    ],
  };
  assert.throws(() => validateState(base), /linked projects/);
  base.trackedDeadlines[0].projectIds = ["a"];
  assert.equal(validateState(base), base);
});
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
