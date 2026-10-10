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

test("dated items share one time order and one countdown wording", () => {
  const {
    upcomingItems,
    countdown,
    dueSoon,
    timeLabel,
  } = require("../src/dates.ts");
  const now = Date.parse("2026-10-09T12:00:00");
  const items = upcomingItems(
    {
      projects: [
        {
          id: "p",
          deadlines: [
            {
              id: "m",
              label: "Camera-ready",
              date: "2026-10-10",
              kind: "other",
            },
            { id: "old", label: "Draft", date: "2026-10-01", kind: "other" },
          ],
        },
      ],
      trackedDeadlines: [
        {
          id: "t",
          label: "Paper",
          time: new Date(now + 22 * 3600000).toISOString(),
          kind: "submission",
          status: "notStarted",
          source: "manual",
          projectIds: ["p", "deleted"],
        },
        {
          id: "done",
          label: "Grant",
          time: new Date(now + 3 * 86400000).toISOString(),
          kind: "other",
          status: "finished",
          source: "manual",
        },
      ],
    },
    now,
  );
  assert.deepEqual(
    items.map((d) => [d.key, d.upcoming]),
    [
      ["p:old", false],
      ["t", true],
      ["p:m", true],
      ["done", false],
    ],
  );
  assert.deepEqual(items[1].projectIds, ["p"]);
  assert.deepEqual(
    dueSoon(items, 1, now).map((d) => d.key),
    ["t"],
  );
  assert.deepEqual(
    items.map((d) => countdown(d.time, now)),
    ["Past", "In 22h", "Tomorrow", "In 3d"],
  );
  assert.deepEqual(
    ["2026-11-19", "2027-01-19", "2029-01-09"].map((date) =>
      countdown(date, now),
    ),
    ["In 41d", "In 3mo", "In 2y"],
  );
  assert.match(
    timeLabel(items[1].time),
    /^\w{3} \w{3} \d{1,2}(, \d{4})? · \d\d:\d\d$/,
  );
});
