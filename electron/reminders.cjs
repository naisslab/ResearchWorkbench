const fs = require("node:fs/promises");
const { atomicWrite } = require("./core.cjs");
const DAY = 86400000;
const isDay = (time) => /^\d{4}-\d\d-\d\d$/.test(time);
// A milestone's calendar day stays due until its local end, as in the app.
const dueAt = (time) =>
  isDay(time) ? Date.parse(`${time}T23:59:59`) : Date.parse(time);
// Local midnight of a calendar day, or of the day an instant falls on.
const dayStart = (time) => {
  const date = new Date(isDay(time) ? `${time}T12:00:00` : time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
// A week ahead, then a day ahead. A date first seen inside the last day gets
// only the closer reminder.
const LEADS = [7, 1];
// Exact times are reminded that many days before; a calendar day is reminded
// at 9:00 that many days before it, not at midnight.
function remindAt(item, days) {
  if (!isDay(item.time)) return item.due - days * DAY;
  const day = dayStart(item.time);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() - days,
    9,
  ).getTime();
}

function upcoming(state, now) {
  const names = new Map(state.projects.map((p) => [p.id, p.name]));
  return [
    ...state.projects.flatMap((p) =>
      p.deadlines.map((d) => ({
        key: `${p.id}:${d.id}`,
        title: d.label,
        time: d.date,
        projects: [p.name],
      })),
    ),
    ...(state.trackedDeadlines || [])
      .filter((d) => d.status !== "finished")
      .map((d) => ({
        key: d.id,
        title: d.label,
        time: d.time,
        projects: [...new Set([...(d.projectIds || []), d.projectId])]
          .map((id) => names.get(id))
          .filter(Boolean),
      })),
  ]
    .map((item) => ({ ...item, due: dueAt(item.time) }))
    .filter((item) => item.due >= now);
}
// Calendar days count as the app does: today, tomorrow, then days.
function remaining(item, now) {
  const hours = Math.round((item.due - now) / 3600000);
  if (!isDay(item.time) && hours < 24)
    return hours <= 1 ? "Due within an hour" : `Due in ${hours} hours`;
  const days = Math.round((dayStart(item.time) - dayStart(now)) / DAY);
  return days === 0
    ? "Due today"
    : days === 1
      ? "Due tomorrow"
      : `Due in ${days} days`;
}
/**
 * Reminders due now that were not sent before. An id includes the due time,
 * so moving a date schedules its reminders again.
 */
function dueReminders(state, sent, now = Date.now()) {
  const reminders = [];
  for (const item of upcoming(state, now)) {
    const leads = LEADS.filter((days) => now >= remindAt(item, days));
    if (!leads.length) continue;
    const ids = leads.map((lead) => `${item.key}\0${item.due}\0${lead}`);
    if (sent.has(ids.at(-1))) continue;
    reminders.push({
      ids,
      title: item.title,
      body: [remaining(item, now), ...item.projects].join(" · "),
    });
  }
  return reminders;
}
function createReminders(file, notify) {
  async function check(state, now = Date.now()) {
    // A damaged record can repeat a reminder once; it never stops them.
    const saved = await fs
      .readFile(file, "utf8")
      .then(JSON.parse)
      .then((value) => ({
        sent: Array.isArray(value?.sent)
          ? value.sent.filter((id) => typeof id === "string")
          : [],
      }))
      .catch(() => ({ sent: [] }));
    // Reminders for past dates are dropped, which keeps the record small.
    const sent = new Set(
      saved.sent.filter((id) => Number(id.split("\0")[1]) >= now),
    );
    const due = dueReminders(state, sent, now);
    for (const reminder of due) {
      notify(reminder);
      for (const id of reminder.ids) sent.add(id);
    }
    if (due.length || sent.size !== saved.sent.length)
      await atomicWrite(file, JSON.stringify({ sent: [...sent] }));
    return due.length;
  }
  return { check };
}
module.exports = { createReminders, dueReminders };
