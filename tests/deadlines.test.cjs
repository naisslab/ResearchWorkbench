const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const ddl = require("../electron/deadlines.cjs");
const { seedWorkspace, validateState } = require("../electron/core.cjs");
const conference = {
  title: "SIGMETRICS",
  dblp: "sigmetrics",
  sub: "DS",
  rank: { ccf: "B" },
  confs: [
    {
      id: "sigmetrics27",
      year: 2027,
      timezone: "AoE",
      link: "https://example.com/cfp",
      timeline: [
        { abstract_deadline: "TBD", deadline: "TBD" },
        {
          abstract_deadline: "2026-10-02 23:59:00",
          deadline: "2026-10-09 23:59:00",
          comment: "fall round",
        },
      ],
    },
  ],
};
const catalog = () => ({
  conferences: [
    ddl.normalizeConference(
      conference,
      "conference/DS/sigmetrics.yml",
      new Date("2026-10-09"),
    ),
  ],
});
test("deadline times preserve AoE, fractional offsets and daylight saving", () => {
  assert.equal(
    ddl.toInstant("2026-10-18 23:59:59", "AoE"),
    "2026-10-19T11:59:59.000Z",
  );
  assert.equal(
    ddl.toInstant("2026-12-01 23:59:59", "UTC+1"),
    "2026-12-01T22:59:59.000Z",
  );
  assert.equal(
    ddl.toInstant("2026-10-09 23:59:00", "UTC+5:30"),
    "2026-10-09T18:29:00.000Z",
  );
  assert.equal(
    ddl.toInstant("2026-07-10 23:59:00", "America/New_York"),
    "2026-07-11T03:59:00.000Z",
  );
  assert.equal(
    ddl.toInstant("2027-01-11 23:59:00", "America/New_York"),
    "2027-01-12T04:59:00.000Z",
  );
  for (const raw of ["TBD", "2026-02-30 23:59:00", "2026-10-09 25:00:00"])
    assert.equal(ddl.toInstant(raw, "AoE"), null);
  assert.equal(ddl.toInstant("2026-10-09 23:59:00", "Mystery/Zone"), null);
});
test("feed keys retain original round indices and distinguish abstract from paper", () => {
  const dates = ddl.flatten(catalog());
  assert.equal(dates.length, 2);
  assert.equal(
    dates[0].sourceKey,
    "sigmetrics:sigmetrics27:1:abstract_deadline",
  );
  assert.equal(dates[1].sourceKey, "sigmetrics:sigmetrics27:1:deadline");
  assert.equal(dates[1].time, "2026-10-10T11:59:00.000Z");
});
test("Mac import preserves personal notes, exact times, status and deliberate multiple-paper entries", async () => {
  const state = await seedWorkspace();
  const tracker = {
    deadlines: [1, 2, 3].map((id) => ({
      id: String(id),
      title: `SIGMETRICS paper ${id}/3`,
      subtitle: "Research Paper",
      category: "paper",
      deadline: "2026-10-10T11:59:59Z",
      status: id === 2 ? "finished" : "ongoing",
      notes: "personal note",
      source: {
        kind: "ccfddl",
        dblpKey: "sigmetrics",
        eventID: "sigmetrics27",
        timelineIndex: 1,
        timelineKind: "paper",
      },
    })),
  };
  const result = ddl.importTracker(state, tracker, catalog());
  assert.equal(result.trackedDeadlines.length, 3);
  assert.equal(result.trackedDeadlines[1].status, "finished");
  assert.equal(result.trackedDeadlines[0].notes, "personal note");
  assert.equal(result.trackedDeadlines[0].time, "2026-10-10T11:59:59.000Z");
  assert.deepEqual(result.projects, state.projects);
  assert.equal(
    ddl.importTracker(result, tracker, catalog()).trackedDeadlines.length,
    3,
  );
  assert.equal(ddl.changes(result, catalog()).length, 0);
  validateState(result);
});
test("tracking deduplicates source keys and update acceptance preserves user fields", async () => {
  const state = ddl.addFeedDates(await seedWorkspace(), catalog(), [
    "sigmetrics:sigmetrics27:1:deadline",
  ]);
  const original = state.trackedDeadlines[0];
  original.status = "ongoing";
  original.notes = "run final evaluation";
  original.projectId = "paper-project";
  const moved = structuredClone(catalog());
  moved.conferences[0].events[0].dates[1].time = "2026-10-11T11:59:00.000Z";
  assert.equal(ddl.changes(state, moved).length, 1);
  assert.equal(state.trackedDeadlines[0].time, "2026-10-10T11:59:00.000Z");
  const changed = ddl.applyUpdates(state, moved, [original.id]);
  assert.equal(changed.trackedDeadlines[0].time, "2026-10-11T11:59:00.000Z");
  assert.equal(changed.trackedDeadlines[0].notes, "run final evaluation");
  assert.equal(changed.trackedDeadlines[0].projectId, original.projectId);
  assert.equal(changed.trackedDeadlines[0].status, "ongoing");
  assert.equal(
    ddl.addFeedDates(state, catalog(), ["sigmetrics:sigmetrics27:1:deadline"])
      .trackedDeadlines.length,
    1,
  );
  assert.throws(() => ddl.addFeedDates(state, catalog(), ["unknown"]));
  validateState(changed);
});
test("WWW setup adds verified dates once and respects removed dates on restart", async () => {
  const state = ddl.seedWeb(await seedWorkspace());
  assert.equal(state.trackedDeadlines.length, 4);
  assert.equal(state.trackedDeadlines[0].time, "2026-10-19T11:59:59.000Z");
  state.trackedDeadlines = [];
  assert.equal(ddl.seedWeb(state), state);
  assert.equal(ddl.seedWeb(state).trackedDeadlines.length, 0);
});
test("refresh caches unchanged blobs and retains last successful data during outages", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-ddl-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let offline = false,
    calls = 0;
  const fetch = async (url) => {
    if (offline) throw new Error("offline");
    if (url.includes("api.github.com"))
      return new Response(
        JSON.stringify({
          sha: "tree-1",
          tree: [
            {
              type: "blob",
              path: "conference/DS/sigmetrics.yml",
              sha: "sha-1",
            },
          ],
        }),
      );
    calls++;
    return new Response(require("js-yaml").dump([conference]));
  };
  const feed = ddl.createFeed(path.join(root, "cache.json"), {
    fetch,
    macDirectory: root,
  });
  const first = await feed.refresh();
  assert.equal(first.conferences.length, 1);
  assert.equal(first.error, null);
  assert.equal(calls, 1);
  const latestSuccess = await feed.refresh();
  assert.equal(calls, 1);
  // An unchanged index keeps the same array, so nothing is broadcast.
  assert.equal(latestSuccess.conferences, first.conferences);
  offline = true;
  const failed = await feed.refresh();
  assert.equal(failed.conferences.length, 1);
  assert.equal(failed.lastSuccessAt, latestSuccess.lastSuccessAt);
  assert.equal(failed.error, "offline");
  const restarted = ddl.createFeed(path.join(root, "cache.json"), {
    fetch,
    macDirectory: root,
  });
  assert.deepEqual((await restarted.snapshot()).conferences, first.conferences);
});
test("workspace validation rejects invalid appearance and unsafe deadline sources", async () => {
  const state = ddl.seedWeb(await seedWorkspace());
  assert.throws(() => validateState({ ...state, appearance: "neon" }));
  state.trackedDeadlines[0].url = "javascript:alert(1)";
  assert.throws(() => validateState(state));
});
