const { DEFAULT_AREAS, validateState } = require("./core.cjs");
const { activateCurrentResearch, mergeCandidates } = require("./catalog.cjs");
const { importTracker, seedWeb } = require("./deadlines.cjs");

const previousNames = {
  ml: ["MLSys", "ML for Systems", "ML & Networked Systems"],
  security: ["Security&Privacy", "Security", "Security & Privacy"],
  cps: ["CPS", "Cyber-Physical Systems", "Cyber-Physical Intelligence"],
};
const previousColors = new Set([
  "#75a6d9",
  "#b89875",
  "#8e95bc",
  "#80b7b0",
  "#d0aa70",
  "#a3a9d9",
  "#91a9d8",
  "#b2a0d3",
  "#9daec7",
]);
function migrateAreaLabels(state) {
  if (state.areaLabelVersion === 2) return state;
  return {
    ...state,
    areaLabelVersion: 2,
    areas: state.areas.map((area) => {
      const current = DEFAULT_AREAS.find((a) => a.id === area.id);
      if (!current) return area;
      return {
        ...area,
        name: previousNames[area.id].includes(area.name)
          ? current.name
          : area.name,
        color: previousColors.has(area.color.toLowerCase())
          ? current.color
          : area.color,
      };
    }),
  };
}

// User-confirmed targets, October 9, 2026: conference dates (by source-key
// prefix) linked to the catalog projects aiming for them. A target does not
// imply submission.
const targets = [
  ["sigmetrics:sigmetrics27:1:", ["synthetic-data-sok"]],
  ["www:www27:0:", ["web-rag"]],
  ["sp:sp27:1:", ["spliceleak", "llm-fingerprints", "agent-firewall"]],
  ["icde:icde27:1:", ["hillinfer"]],
  ["osdi:osdi2027:0:", ["traceforge", "tracefoundry"]],
];
function applySubmissionPlans(state, catalog) {
  if (state.submissionPlanVersion === 1) return state;
  const next = mergeCandidates(state, catalog, [
    "web-rag",
    "agent-firewall",
    "rag-serving",
  ]);
  const trackedDeadlines = (next.trackedDeadlines || []).map((date) => {
    const target = targets.find(([key]) => date.sourceKey?.startsWith(key));
    if (!target) return date;
    const linked = next.projects
      .filter((project) => target[1].includes(project.catalogId))
      .map((project) => project.id);
    return {
      ...date,
      projectIds: [
        ...new Set([
          ...(date.projectIds || []),
          ...(date.projectId ? [date.projectId] : []),
          ...linked,
        ]),
      ],
    };
  });
  return { ...next, trackedDeadlines, submissionPlanVersion: 1 };
}

function defaultToSystemAppearance(state) {
  if (state.appearanceDefaultVersion === 1) return state;
  return { ...state, appearance: "system", appearanceDefaultVersion: 1 };
}

// One-time workspace upgrades, in order. Each returns its input unchanged once
// applied, and reads catalog, tracker or feed data only while it still applies.
const personalMigrations = [
  async (state, { catalog }) =>
    state.researchSetupVersion === 1
      ? state
      : activateCurrentResearch(state, await catalog()),
  async (state, { tracker, feed }) => {
    if (state.deadlineImportVersion === 1) return state;
    try {
      const saved = await tracker();
      return saved ? importTracker(state, saved, await feed()) : state;
    } catch (error) {
      console.error(
        "Mac deadlines were preserved; import failed:",
        error.message,
      );
      return state;
    }
  },
  seedWeb,
  async (state, { catalog }) =>
    state.submissionPlanVersion === 1
      ? state
      : applySubmissionPlans(state, await catalog()),
];
// `sources` supplies catalog(), tracker() and feed(); the catalog is read once.
async function runMigrations(
  saved,
  sources = {},
  { includePersonalData = false } = {},
) {
  let catalog;
  const context = {
    ...sources,
    catalog: () => (catalog ??= sources.catalog()),
  };
  let state = saved;
  // Personal imports are explicitly requested. Existing records always survive.
  const migrations = [
    migrateAreaLabels,
    ...(includePersonalData ? personalMigrations : []),
    defaultToSystemAppearance,
  ];
  for (const migrate of migrations) state = await migrate(state, context);
  return state === saved ? saved : validateState(state);
}

module.exports = {
  migrateAreaLabels,
  applySubmissionPlans,
  defaultToSystemAppearance,
  runMigrations,
};
