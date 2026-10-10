import type {
  DateCategory,
  DeadlineKind,
  TrackedDeadline,
  Workspace,
} from "./types";

/** A `YYYY-MM-DD` calendar day, an ISO instant or epoch milliseconds. */
type When = string | number;
export const DAY = 86400000;
const isDateOnly = (value: When) =>
  typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value);
// A calendar day resolves to local noon, which exists even on DST change days.
const toDate = (value: When) =>
  new Date(isDateOnly(value) ? `${value}T12:00:00` : value);
const startOfDay = (value: When) => {
  const date = toDate(value);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};
/** When an item is due, in epoch ms; a calendar day stays due until its local end. */
export const dueAt = (time: string) =>
  isDateOnly(time) ? Date.parse(`${time}T23:59:59`) : Date.parse(time);

const formats = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, timeZone = "") {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timeZone || undefined,
    });
    formats.set(timeZone, format);
  }
  return Object.fromEntries(
    format.formatToParts(date).map((part) => [part.type, part.value]),
  );
}
function label(date: Date, withTime: boolean, timeZone?: string) {
  const p = parts(date, timeZone);
  const day =
    `${p.weekday} ${p.month} ${p.day}` +
    (p.year === String(new Date().getFullYear()) ? "" : `, ${p.year}`);
  return withTime ? `${day} · ${p.hour}:${p.minute}` : day;
}

export function localDate(time: When) {
  const date = toDate(time);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
export const timeLabel = (time: When) => label(toDate(time), !isDateOnly(time));
export const monthShort = (date: When) => parts(toDate(date)).month;
export function monthDay(date: When) {
  const p = parts(toDate(date));
  return `${p.month} ${p.day}`;
}
/** The time in the deadline's own time zone, e.g. `Fri Oct 9 · 23:59 AoE`. */
export function sourceTime(
  d: Pick<TrackedDeadline, "time" | "timezone" | "originalDate">,
) {
  const offset = /^UTC([+-])(\d{1,2})(?::(\d\d))?$/.exec(d.timezone);
  const hours =
    d.timezone === "AoE"
      ? -12
      : offset &&
        (offset[1] === "-" ? -1 : 1) * (+offset[2] + +(offset[3] || 0) / 60);
  // A source wall-clock time is written as UTC so it prints unchanged.
  const wallClock = d.originalDate
    ? `${d.originalDate.slice(0, 16).replace(" ", "T")}Z`
    : hours !== null && Date.parse(d.time) + hours * 3600000;
  try {
    const zone = wallClock ? "UTC" : d.timezone;
    return `${label(new Date(wallClock || d.time), true, zone)} ${d.timezone}`;
  } catch {
    return timeLabel(d.time);
  }
}
/** Hours under two days, then days, months and years; a calendar day can be `Today` or `Tomorrow`. */
export function countdown(time: When, now = Date.now()) {
  let days: number;
  if (isDateOnly(time)) {
    days = Math.round((startOfDay(time) - startOfDay(now)) / DAY);
    if (days < 0) return "Past";
    if (days < 2) return days ? "Tomorrow" : "Today";
  } else {
    const minutes = Math.floor((toDate(time).getTime() - now) / 60000);
    if (minutes < 0) return "Past";
    if (minutes < 60) return `In ${minutes}m`;
    if (minutes < 48 * 60) return `In ${Math.floor(minutes / 60)}h`;
    days = Math.floor(minutes / 1440);
  }
  const months = Math.floor(days / 30.4375);
  if (days < 100) return `In ${days}d`;
  return months < 24 ? `In ${months}mo` : `In ${Math.floor(months / 12)}y`;
}

/** A tracked date's projects; older records kept a single `projectId`. */
export const linkedProjectIds = (date: TrackedDeadline) => [
  ...new Set([
    ...(date.projectIds || []),
    ...(date.projectId ? [date.projectId] : []),
  ]),
];
/** Items due from `now` to `days` later; `items` must be built for the same `now`. */
export const dueSoon = (items: DatedItem[], days: number, now: number) =>
  items.filter((item) => item.upcoming && dueAt(item.time) < now + days * DAY);

export interface DatedItem {
  key: string;
  title: string;
  /** An ISO instant, or `YYYY-MM-DD` for a project milestone. */
  time: string;
  upcoming: boolean;
  projectIds: string[];
  kind: DeadlineKind;
  category: DateCategory;
  status?: TrackedDeadline["status"];
  url?: string;
  deadlineId?: string;
  trackedId?: string;
}
/** Project milestones and tracked dates, past and finished ones included, sorted by exact time. */
export function upcomingItems(
  state: Pick<Workspace, "projects" | "trackedDeadlines">,
  now = Date.now(),
): DatedItem[] {
  const known = new Set(state.projects.map((p) => p.id));
  return [
    ...state.projects.flatMap((p) =>
      p.deadlines.map((d): DatedItem => ({
        key: `${p.id}:${d.id}`,
        title: d.label,
        time: d.date,
        upcoming: dueAt(d.date) >= now,
        projectIds: [p.id],
        kind: d.kind,
        category: "paper",
        url: d.url,
        deadlineId: d.id,
      })),
    ),
    ...state.trackedDeadlines.map((d): DatedItem => ({
      key: d.id,
      title: d.label,
      time: d.time,
      upcoming: d.status !== "finished" && Date.parse(d.time) >= now,
      projectIds: linkedProjectIds(d).filter((id) => known.has(id)),
      kind: d.kind,
      category: d.category,
      status: d.status,
      url: d.url,
      trackedId: d.id,
    })),
  ].sort((a, b) => dueAt(a.time) - dueAt(b.time));
}
