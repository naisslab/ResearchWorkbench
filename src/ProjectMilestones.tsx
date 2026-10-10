import { useState } from "react";
import {
  CalendarDays,
  CircleCheck,
  Clock3,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import type {
  Commit,
  CommitWithUndo,
  Deadline,
  DeadlineKind,
  Project,
  Workspace,
} from "./types";
import { deadlineKinds } from "./types";
import Modal from "./Modal";
import {
  countdown,
  DAY,
  dueAt,
  localDate,
  monthShort,
  timeLabel,
  type DatedItem,
} from "./dates";

export const kindLabel = (kind: DeadlineKind) =>
  deadlineKinds.find((k) => k.id === kind)?.name;
export const kindOptions = deadlineKinds.map((k) => (
  <option key={k.id} value={k.id}>
    {k.name}
  </option>
));

export function Urgency({
  time,
  now,
  done,
}: {
  time: string;
  now: number;
  done?: boolean;
}) {
  const left = dueAt(time) - now;
  const tone =
    done || left < 0
      ? "past"
      : left < DAY
        ? "urgent"
        : left < 7 * DAY
          ? "soon"
          : left < 30 * DAY
            ? "month"
            : "later";
  return (
    <span className={`date-urgency urgency-${tone}`}>
      {done ? <CircleCheck size={12} /> : <Clock3 size={12} />}
      {done ? "Done" : countdown(time, now)}
    </span>
  );
}

/** Day over month; the year appears only outside the current one. */
export function DateBlock({ time }: { time: string }) {
  const [year, , day] = localDate(time).split("-");
  return (
    <div className="date-calendar-day" title={timeLabel(time)}>
      <strong>{+day}</strong>
      <span>
        {monthShort(time)}
        {year !== String(new Date().getFullYear()) && ` ${year}`}
      </span>
    </div>
  );
}

const withMilestones =
  (projectId: string, fn: (list: Deadline[]) => Deadline[]) =>
  (s: Workspace): Workspace => ({
    ...s,
    projects: s.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            deadlines: fn(p.deadlines),
            updatedAt: new Date().toISOString(),
          }
        : p,
    ),
  });

export function MilestoneEditor({
  projects,
  projectId: initialProject,
  milestone,
  commit,
  close,
}: {
  projects: Project[];
  /** Empty to let the user pick the project. */
  projectId: string;
  milestone?: Deadline;
  commit: Commit;
  close(): void;
}) {
  const [projectId, setProjectId] = useState(initialProject);
  const [label, setLabel] = useState(milestone?.label || "");
  const [date, setDate] = useState(milestone?.date || "");
  const [kind, setKind] = useState(milestone?.kind || "submission");
  const [url, setUrl] = useState(milestone?.url || "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={milestone ? "Edit milestone" : "Keep a date in sight"}
      onClose={close}
      locked={busy}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const next = {
            id: milestone?.id || crypto.randomUUID(),
            label: label.trim(),
            date,
            kind,
            url: url.trim() || undefined,
          };
          const saved = await commit(
            withMilestones(projectId, (list) =>
              milestone
                ? list.map((d) => (d.id === next.id ? next : d))
                : [...list, next],
            ),
          );
          setBusy(false);
          if (saved) close();
        }}
      >
        <label>
          Project
          <select
            required
            disabled={!!initialProject}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="" disabled>
              Choose a project
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Milestone name
          <input
            required
            placeholder="e.g. Conference paper submission"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DeadlineKind)}
            >
              {kindOptions}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label>
          Source link <span className="optional">optional</span>
          <input
            type="url"
            placeholder="https://conference.org/cfp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button
            className="button primary"
            disabled={busy || !projectId || !label.trim() || !date}
          >
            {milestone ? "Save changes" : "Add milestone"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProjectMilestones({
  state,
  items,
  area,
  query,
  includePast,
  now,
  commitWithUndo,
  openProject,
  onEdit,
}: {
  state: Workspace;
  items: DatedItem[];
  area: string;
  query: string;
  includePast: boolean;
  now: number;
  commitWithUndo: CommitWithUndo;
  openProject(id: string): void;
  onEdit(item: DatedItem, project: Project): void;
}) {
  const projects = new Map(state.projects.map((p) => [p.id, p]));
  const colors = new Map(state.areas.map((a) => [a.id, a.color]));
  const q = query.toLowerCase();
  const rows = items.flatMap((item) =>
    item.projectIds.flatMap((id) => {
      const project = projects.get(id)!;
      return (area === "all" || project.areaId === area) &&
        (includePast || dueAt(item.time) >= now) &&
        `${item.title} ${project.name} ${project.venue}`
          .toLowerCase()
          .includes(q)
        ? [{ item, project }]
        : [];
    }),
  );
  if (!rows.length)
    return (
      <div className="dates-empty">
        <CalendarDays size={30} />
        <h3>No milestones in this view</h3>
        <p>Add a milestone, or link a tracked date to a project.</p>
      </div>
    );
  return (
    <div className="deadline-table">
      {rows.map(({ item, project }) => (
        <div className="deadline-table-row" key={`${item.key}:${project.id}`}>
          <DateBlock time={item.time} />
          <button
            className="deadline-project"
            onClick={() => openProject(project.id)}
          >
            <strong>{item.title}</strong>
            <span>
              <i
                style={
                  {
                    "--area-color": colors.get(project.areaId),
                  } as React.CSSProperties
                }
              />
              {project.name}
              {project.venue && ` · ${project.venue}`}
            </span>
          </button>
          <span className={`date-kind kind-${item.kind}`}>
            {kindLabel(item.kind)}
          </span>
          <Urgency
            time={item.time}
            now={now}
            done={item.status === "finished"}
          />
          <div className="date-row-tools">
            <button
              className="icon-button"
              title={`Edit ${item.title}`}
              onClick={() => onEdit(item, project)}
            >
              <Pencil size={14} />
            </button>
            {item.url ? (
              <button
                className="icon-button"
                title={`Open source for ${item.title}`}
                onClick={() => void window.research!.openLink(item.url!)}
              >
                <ExternalLink size={14} />
              </button>
            ) : (
              <span />
            )}
            {item.deadlineId && (
              <button
                className="icon-button"
                title={`Remove ${item.title}`}
                onClick={() =>
                  void commitWithUndo(
                    `Removed “${item.title}”`,
                    withMilestones(project.id, (list) =>
                      list.filter((d) => d.id !== item.deadlineId),
                    ),
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
