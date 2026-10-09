import type { Project, Stage, TrackedDeadline } from "./types";

export const priorityStages: Stage[] = [
  "writing",
  "revision",
  "experiments",
  "exploration",
  "submitted",
  "accepted",
  "published",
];

export function sortProjects(
  projects: Project[],
  today = new Date().toLocaleDateString("en-CA"),
  trackedDates: TrackedDeadline[] = [],
) {
  const nextSubmission = (project: Project) =>
    [
      ...project.deadlines,
      ...trackedDates
        .filter(
          (d) =>
            d.status !== "finished" &&
            (d.projectIds?.includes(project.id) || d.projectId === project.id),
        )
        .map((d) => ({
          kind: d.kind,
          date: new Date(d.time).toLocaleDateString("en-CA"),
        })),
    ]
      .filter(
        (d) =>
          ["abstract", "submission", "revision"].includes(d.kind) &&
          d.date >= today,
      )
      .map((d) => d.date)
      .sort()[0] || "9999-12-31";
  return [...projects].sort(
    (a, b) =>
      priorityStages.indexOf(a.stage) - priorityStages.indexOf(b.stage) ||
      nextSubmission(a).localeCompare(nextSubmission(b)),
  );
}
