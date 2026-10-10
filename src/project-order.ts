import type { DeadlineKind, Project, Stage, TrackedDeadline } from "./types";
import { localDate, upcomingItems } from "./dates.ts";

export const priorityStages: Stage[] = [
  "writing",
  "revision",
  "experiments",
  "exploration",
  "submitted",
  "accepted",
  "published",
];
const submissionKinds: DeadlineKind[] = ["abstract", "submission", "revision"];

export function sortProjects(
  projects: Project[],
  today = localDate(Date.now()),
  trackedDates: TrackedDeadline[] = [],
) {
  const items = upcomingItems(
    { projects, trackedDeadlines: trackedDates },
    Date.parse(`${today}T00:00:00`),
  );
  // Items are in time order, so a project's first match is its next submission.
  const next = new Map<string, number>();
  items.forEach((d, index) => {
    if (d.upcoming && submissionKinds.includes(d.kind))
      for (const id of d.projectIds) if (!next.has(id)) next.set(id, index);
  });
  const rank = (p: Project) => next.get(p.id) ?? items.length;
  return [...projects].sort(
    (a, b) =>
      priorityStages.indexOf(a.stage) - priorityStages.indexOf(b.stage) ||
      rank(a) - rank(b),
  );
}
