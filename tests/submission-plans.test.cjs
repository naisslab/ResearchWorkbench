const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  applySubmissionPlans,
  defaultToSystemAppearance,
} = require("../electron/submission-plans.cjs");
const {
  researchCatalog,
  activateCurrentResearch,
} = require("../electron/catalog.cjs");
const { validateState } = require("../electron/core.cjs");
const data = require("../electron/research-catalog.json");

test("confirmed submission plans link shared dates, preserve exact times and remain editable after migration", async () => {
  const catalog = await researchCatalog("/tmp/no-research-folders");
  const base = activateCurrentResearch(
    { version: 1, areas: data.areas, projects: [], trackedDeadlines: [] },
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
    areas: data.areas,
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
