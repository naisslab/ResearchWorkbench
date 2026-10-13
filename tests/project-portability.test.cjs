const { test } = require("node:test");
const assert = require("node:assert/strict");
const { seedWorkspace, validateState } = require("../electron/core.cjs");
const {
  makeProjectManifest,
  validateProjectManifest,
  importProjectManifest,
  exportCalendar,
} = require("../electron/project-portability.cjs");
const revision = "a".repeat(40);
function workspace() {
  const state = seedWorkspace();
  state.projects = [
    {
      id: "paper",
      areaId: state.areas[0].id,
      name: "Research; experiment",
      summary: "A test project",
      stage: "writing",
      folder: "/private/research",
      mainFile: "sections/main.tex",
      sshHost: "private-host",
      venue: "Example venue",
      notes: "Shareable research notes",
      updatedAt: "2026-10-13T08:00:00.000Z",
      owner: "Alex",
      sourceNote: "/private/source with metadata",
      localFolders: [{ id: "code", label: "Code", folder: "/private/code" }],
      links: [
        { label: "Private", url: "https://private.example?token=SECRET" },
      ],
      tasks: [
        {
          id: "task",
          text: "Check results",
          done: false,
          assignee: "Sam",
          dueDate: "2026-11-01",
        },
      ],
      deadlines: [
        {
          id: "milestone",
          label: "Draft ready",
          date: "2026-10-31",
          kind: "other",
        },
      ],
      reviewRequests: [
        {
          id: "review",
          title: "Review evaluation",
          requestedAt: "2026-10-12T08:00:00.000Z",
          revision,
          status: "reviewed",
          reviewedAt: "2026-10-13T08:00:00.000Z",
          reviewedRevision: revision,
        },
      ],
      decisions: [
        {
          id: "decision",
          text: "Add a baseline",
          createdAt: "2026-10-13T08:00:00.000Z",
          revision,
        },
      ],
      lastReviewedCommit: revision,
    },
  ];
  state.trackedDeadlines = [
    {
      id: "conference",
      label: "Submission, final",
      subtitle: "Paper deadline",
      category: "paper",
      kind: "submission",
      time: "2026-11-02T11:59:59.000Z",
      timezone: "AoE",
      originalDate: "2026-11-01 23:59:59",
      status: "ongoing",
      source: "manual",
      projectIds: ["paper"],
      url: "https://conference.example/deadline",
    },
  ];
  return state;
}
test("portable project round trip retains research context while removing local bindings and unknown private fields", () => {
  const source = workspace();
  source.projects[0].credentials = { apiKey: "SECRET" };
  source.projects[0].tasks[0].privateToken = "SECRET";
  source.projects[0].reviewRequests[0].conversation = "PRIVATE CHAT";
  const manifest = makeProjectManifest(source, "paper");
  const json = JSON.stringify(manifest);
  assert.doesNotMatch(
    json,
    /\/private\/|private-host|SECRET|PRIVATE CHAT|localFolders|sourceNote|credentials/,
  );
  assert.equal(manifest.project.owner, "Alex");
  assert.equal(manifest.project.lastReviewedCommit, revision);
  assert.equal(manifest.trackedDeadlines[0].timezone, "AoE");
  assert.equal(manifest.trackedDeadlines[0].projectIds, undefined);
  const { workspace: imported, project } = importProjectManifest(
    source,
    JSON.parse(json),
  );
  assert.equal(source.projects.length, 1, "does not mutate the source");
  assert.equal(imported.projects.length, 2);
  assert.notEqual(project.id, "paper");
  assert.notEqual(project.tasks[0].id, "task");
  assert.equal(project.folder, "");
  assert.equal(project.sshHost, "");
  assert.equal(project.mainFile, "sections/main.tex");
  assert.equal(project.reviewRequests[0].reviewedRevision, revision);
  assert.deepEqual(imported.trackedDeadlines[1].projectIds, [project.id]);
  assert.notEqual(imported.trackedDeadlines[1].id, "conference");
  validateState(imported);
});
test("manifest validates schema, relative paths, dates and review revisions before import", () => {
  const manifest = makeProjectManifest(workspace(), "paper");
  for (const version of [0, 2, "1"])
    assert.throws(
      () => validateProjectManifest({ ...manifest, version }),
      /version 1/,
    );
  for (const mainFile of [
    "/private/main.tex",
    "../main.tex",
    "a/../../main.tex",
    "C:\\private\\main.tex",
    "a//main.tex",
  ])
    assert.throws(
      () =>
        validateProjectManifest({
          ...manifest,
          project: { ...manifest.project, mainFile },
        }),
      /relative/,
    );
  assert.throws(
    () =>
      validateProjectManifest({
        ...manifest,
        project: {
          ...manifest.project,
          tasks: [{ ...manifest.project.tasks[0], dueDate: "2026-02-30" }],
        },
      }),
    /task/,
  );
  assert.throws(
    () =>
      validateProjectManifest({
        ...manifest,
        project: {
          ...manifest.project,
          reviewRequests: [
            {
              ...manifest.project.reviewRequests[0],
              reviewedRevision: undefined,
            },
          ],
        },
      }),
    /review request/,
  );
  assert.throws(
    () => importProjectManifest(workspace(), manifest, { areaId: "missing" }),
    /research area/,
  );
  const bad = {
    ...manifest,
    project: {
      ...manifest.project,
      decisions: [{ ...manifest.project.decisions[0], revision: "HEAD; rm" }],
    },
  };
  assert.throws(() => validateProjectManifest(bad), /decision/);
});
test("credential-bearing source URLs are omitted from portable metadata", () => {
  const state = workspace();
  state.trackedDeadlines[0].url = "https://user:secret@conference.example/";
  state.trackedDeadlines[0].sourceUrl =
    "https://conference.example?access_token=secret";
  const manifest = makeProjectManifest(state, "paper");
  assert.equal(manifest.trackedDeadlines[0].url, undefined);
  assert.equal(manifest.trackedDeadlines[0].sourceUrl, undefined);
});
test("calendar keeps exact timezone-adjusted instants and all-day boundaries, with stable UIDs", () => {
  const state = workspace();
  const options = { now: "2026-10-13T00:00:00.000Z" };
  const calendar = exportCalendar(state, options);
  assert.match(calendar, /DTSTART:20261102T115959Z/);
  assert.match(calendar, /Source timezone: AoE/);
  assert.match(
    calendar,
    /DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101/,
  );
  assert.match(
    calendar,
    /DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102/,
  );
  assert.match(calendar, /SUMMARY:Research\\; experiment: Draft ready/);
  assert.match(calendar, /SUMMARY:Submission\\, final/);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.deepEqual(
    calendar.match(/UID:.+/g),
    exportCalendar(state, { now: "2026-10-14T00:00:00.000Z" }).match(/UID:.+/g),
  );
  assert.equal(
    exportCalendar(state, { ...options, projectId: "paper" }),
    calendar,
  );
  assert.throws(
    () => exportCalendar(state, { projectId: "missing" }),
    /no longer exists/,
  );
});
test("calendar escapes embedded newlines and folds UTF-8 without splitting characters", () => {
  const state = workspace();
  state.trackedDeadlines[0].label = "研究".repeat(50) + "\nBEGIN:VEVENT";
  const calendar = exportCalendar(state, { now: "2026-10-13T00:00:00.000Z" });
  assert.equal((calendar.match(/\r\nBEGIN:VEVENT\r\n/g) || []).length, 3);
  for (const line of calendar.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.match(calendar.replace(/\r\n /g, ""), /\\nBEGIN:VEVENT/);
  assert.doesNotMatch(calendar, /\uFFFD/);
});
test("existing workspaces need no PI fields and fresh workspaces stay generic", () => {
  const state = workspace();
  for (const key of [
    "owner",
    "reviewRequests",
    "decisions",
    "lastReviewedCommit",
  ])
    delete state.projects[0][key];
  validateState(state);
  assert.deepEqual(
    seedWorkspace().areas.map((area) => area.name),
    ["Research"],
  );
  assert.equal(seedWorkspace({ personal: true }).areas.length, 3);
});
