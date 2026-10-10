const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createReminders, dueReminders } = require("../electron/reminders.cjs");
const DAY = 86400000;
const now = Date.parse("2026-10-10T09:00:00Z");
const state = (time, extra = {}) => ({
  projects: [
    {
      id: "p",
      name: "HillInfer",
      deadlines: [
        {
          id: "m",
          label: "Artifact freeze",
          date: "2026-10-30",
          kind: "other",
        },
      ],
    },
  ],
  trackedDeadlines: [
    {
      id: "icde",
      label: "ICDE paper",
      time,
      status: "ongoing",
      projectIds: ["p"],
      ...extra,
    },
  ],
});
test("a date gets one reminder a week ahead and one a day ahead, naming its projects", () => {
  const time = new Date(now + 5 * DAY).toISOString();
  const [week] = dueReminders(state(time), new Set(), now);
  assert.equal(week.title, "ICDE paper");
  assert.equal(week.body, "Due in 5 days · HillInfer");
  assert.equal(dueReminders(state(time), new Set(week.ids), now).length, 0);
  const later = now + 4.5 * DAY;
  const [day] = dueReminders(state(time), new Set(week.ids), later);
  assert.equal(day.body, "Due in 12 hours · HillInfer");
});
test("a date first seen inside the last day gets a single reminder", () => {
  const time = new Date(now + 3 * 3600000).toISOString();
  const due = dueReminders(state(time), new Set(), now);
  assert.equal(due.length, 1);
  assert.equal(due[0].ids.length, 2);
  assert.equal(dueReminders(state(time), new Set(due[0].ids), now).length, 0);
});
test("finished, past and distant dates stay quiet, and a moved date reminds again", () => {
  const soon = new Date(now + 2 * DAY).toISOString();
  assert.deepEqual(
    dueReminders(state(soon, { status: "finished" }), new Set(), now),
    [],
  );
  assert.deepEqual(
    dueReminders(state(new Date(now - DAY).toISOString()), new Set(), now),
    [],
  );
  assert.deepEqual(
    dueReminders(state(new Date(now + 30 * DAY).toISOString()), new Set(), now),
    [],
  );
  const [first] = dueReminders(state(soon), new Set(), now);
  const moved = new Date(now + 3 * DAY).toISOString();
  assert.equal(dueReminders(state(moved), new Set(first.ids), now).length, 1);
});
test("sent reminders survive a restart and past ones are pruned", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "research-remind-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "reminders.json");
  const shown = [];
  const reminders = createReminders(file, (item) => shown.push(item.title));
  const workspace = state(new Date(now + 2 * DAY).toISOString());
  // The milestone on Oct 30 is 20 days out and stays quiet.
  assert.equal(await reminders.check(workspace, now), 1);
  assert.equal(await createReminders(file, () => {}).check(workspace, now), 0);
  assert.deepEqual(shown, ["ICDE paper"]);
  await createReminders(file, () => {}).check(workspace, now + 10 * DAY);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).sent, []);
});
test("a damaged reminder record does not stop reminders", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "research-remind-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, "reminders.json");
  for (const damaged of ["{", "null", '{"sent":3}', '{"sent":[null,1]}']) {
    await fs.writeFile(file, damaged);
    const shown = [];
    const workspace = state(new Date(now + 2 * DAY).toISOString());
    assert.equal(
      await createReminders(file, (item) => shown.push(item.title)).check(
        workspace,
        now,
      ),
      1,
    );
    assert.deepEqual(shown, ["ICDE paper"]);
  }
});
test("a calendar-day milestone is reminded at 9:00 a week and a day before, in calendar days", () => {
  const milestone = { ...state(), trackedDeadlines: [] };
  const at = (day, hour) => new Date(2026, 9, day, hour).getTime();
  assert.deepEqual(dueReminders(milestone, new Set(), at(23, 8)), []);
  const [week] = dueReminders(milestone, new Set(), at(23, 9));
  assert.equal(week.body, "Due in 7 days · HillInfer");
  assert.deepEqual(dueReminders(milestone, new Set(week.ids), at(29, 8)), []);
  const [day] = dueReminders(milestone, new Set(week.ids), at(29, 9));
  assert.equal(day.body, "Due tomorrow · HillInfer");
  const [today] = dueReminders(milestone, new Set(), at(30, 10));
  assert.equal(today.body, "Due today · HillInfer");
});
