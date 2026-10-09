import type { TrackedDeadline } from "./types";

export function linkedProjectIds(date: TrackedDeadline): string[] {
  return [
    ...new Set([
      ...(date.projectIds || []),
      ...(date.projectId ? [date.projectId] : []),
    ]),
  ];
}

export function datesForProject(dates: TrackedDeadline[], projectId: string) {
  return dates
    .filter((date) => linkedProjectIds(date).includes(projectId))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}
