const { mergeCandidates } = require("./catalog.cjs");

// User-confirmed targets, October 9, 2026. A target does not imply submission.
const plans = [
  {
    venue: "SIGMETRICS 2027",
    projects: ["synthetic-data-sok"],
    keys: ["sigmetrics:sigmetrics27:1:"],
  },
  { venue: "WWW 2027", projects: ["web-rag"], keys: ["www:www27:0:"] },
  {
    venue: "IEEE S&P 2027",
    projects: ["spliceleak", "llm-fingerprints", "agent-firewall"],
    keys: ["sp:sp27:1:"],
  },
  { venue: "ICDE 2027", projects: ["hillinfer"], keys: ["icde:icde27:1:"] },
  {
    venue: "OSDI 2027",
    projects: ["traceforge", "tracefoundry"],
    keys: ["osdi:osdi2027:0:"],
  },
  { venue: "ACM Computing Surveys", projects: ["rag-serving"], keys: [] },
];

function applySubmissionPlans(state, catalog) {
  if (state.submissionPlanVersion === 1) return state;
  const next = mergeCandidates(state, catalog, [
    "web-rag",
    "agent-firewall",
    "rag-serving",
  ]);
  const updatedAt = new Date().toISOString();
  const projects = next.projects.map((project) => {
    const plan = plans.find((plan) =>
      plan.projects.includes(project.catalogId),
    );
    if (!plan) return project;
    let result = { ...project, venue: plan.venue, updatedAt };
    if (project.catalogId === "spliceleak") result.stage = "revision";
    if (project.catalogId === "hillinfer") result.stage = "writing";
    if (project.catalogId === "agent-firewall")
      result = {
        ...result,
        name: "Language Model Firewall",
        summary:
          "A stateful firewall that checks LLM agent tool calls before execution.",
        sourceNote:
          "Verified Overleaf manuscript: Stateful Firewall for LLM Agents in Home Routers. User-selected target: IEEE S&P 2027 (October 9, 2026).",
        notes:
          "Target: IEEE S&P 2027. Overleaf manuscript inspected October 9, 2026: Stateful Firewall for LLM Agents in Home Routers.",
      };
    if (project.catalogId === "web-rag")
      result.summary = "Web RAG manuscript targeting The Web Conference 2027.";
    if (project.catalogId === "rag-serving")
      result.summary = "RAG serving survey targeting ACM Computing Surveys.";
    if (project.catalogId === "tracefoundry") {
      const url = "https://github.com/naisslab/Cross-Trace-Synth";
      result.links = [
        ...(project.links || []).filter((link) => link.url !== url),
        { label: "GitHub · Manuscript", url },
      ];
      result.notes =
        "The user confirmed Synthetic Job Schedulers as the TraceFoundry manuscript. Target: OSDI 2027. The local manuscript already uses the naisslab/Cross-Trace-Synth GitHub repository. Overleaf GitHub integration was verified on October 9, 2026: Synthetic Job Schedulers is linked to naisslab/Cross-Trace-Synth.";
    }
    return result;
  });
  const trackedDeadlines = (next.trackedDeadlines || []).map((date) => {
    const plan = plans.find((plan) =>
      plan.keys.some((key) => date.sourceKey?.startsWith(key)),
    );
    if (!plan) return date;
    const linked = projects
      .filter((project) => plan.projects.includes(project.catalogId))
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
  return { ...next, projects, trackedDeadlines, submissionPlanVersion: 1 };
}

function defaultToSystemAppearance(state) {
  if (state.appearanceDefaultVersion === 1) return state;
  return { ...state, appearance: "system", appearanceDefaultVersion: 1 };
}

module.exports = { plans, applySubmissionPlans, defaultToSystemAppearance };
