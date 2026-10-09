const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sortProjects, priorityStages } = require("../src/project-order.ts");

test("submission work comes before finished papers and nearer submission dates win within a stage", () => {
  const project = (id, stage, date, kind = "submission") => ({
    id,
    stage,
    deadlines: date ? [{ date, kind }] : [],
  });
  const input = [
    project("accepted", "accepted", "2026-10-10", "camera-ready"),
    project("writing-later", "writing", "2026-11-01"),
    project("writing-soon", "writing", "2026-10-11"),
    project("revision", "revision"),
    project("published", "published"),
    project("waiting", "submitted"),
    project("experiments", "experiments"),
    project("writing-past", "writing", "2026-10-01"),
  ];
  const result = sortProjects(input, "2026-10-09");
  assert.deepEqual(
    result.map((p) => p.id),
    [
      "writing-soon",
      "writing-later",
      "writing-past",
      "revision",
      "experiments",
      "waiting",
      "accepted",
      "published",
    ],
  );
  assert.equal(input[0].id, "accepted");
  assert.deepEqual(priorityStages.slice(-2), ["accepted", "published"]);
});

test("shared conference associations also prioritize the sidebar without mutating project milestones", () => {
  const projects = ["later", "soon", "legacy", "finished"].map((id) => ({
    id,
    stage: "writing",
    deadlines: [],
  }));
  const dates = [
    {
      projectIds: ["soon"],
      time: "2026-10-11T12:00:00Z",
      kind: "submission",
      status: "notStarted",
    },
    {
      projectIds: ["later"],
      time: "2026-11-11T12:00:00Z",
      kind: "abstract",
      status: "notStarted",
    },
    {
      projectId: "legacy",
      time: "2026-10-12T12:00:00Z",
      kind: "submission",
      status: "ongoing",
    },
    {
      projectIds: ["finished"],
      time: "2026-10-10T12:00:00Z",
      kind: "submission",
      status: "finished",
    },
  ];
  assert.deepEqual(
    sortProjects(projects, "2026-10-09", dates).map((p) => p.id),
    ["soon", "legacy", "later", "finished"],
  );
  assert.ok(projects.every((p) => p.deadlines.length === 0));
});
