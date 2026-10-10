import { useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  FolderOpen,
  Library,
  Link2,
  ListTodo,
  Milestone,
  NotebookPen,
  Plus,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import type { Area, Project, ProjectChanges } from "../types";
import { stages } from "../types";
import type { DatedItem } from "../dates";
import { DateBlock, kindLabel, Urgency } from "../ProjectMilestones";
import { BlurField, openExternal, Options, TaskAdd } from "../components/ui";

export default function ProjectDetailsView({
  project: p,
  dates,
  areas,
  update,
  edit,
  remove,
  report,
}: {
  project: Project;
  dates: DatedItem[];
  areas: Area[];
  update(changes: ProjectChanges, undo?: string): void;
  edit(item?: DatedItem): void;
  remove(): void;
  report(message: string): void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    window.research!.listFiles(p.id).then(setFiles, () => setFiles([]));
  }, [p.id, p.folder]);
  const current = stages.findIndex((s) => s.id === p.stage);
  const now = Date.now();
  const texFiles = files.filter((f) => f.endsWith(".tex"));
  if (p.mainFile && !texFiles.includes(p.mainFile))
    texFiles.unshift(p.mainFile);
  return (
    <div className="details-layout">
      <div className="details-main">
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <FolderOpen size={17} /> Project identity
            </h2>
          </div>
          <label>
            Project name
            <BlurField
              value={p.name}
              required
              onCommit={(name) => update({ name })}
            />
          </label>
          <label>
            Research question or description
            <BlurField
              value={p.summary}
              multiline
              rows={3}
              onCommit={(summary) => update({ summary })}
            />
          </label>
          <label>
            Research area
            <select
              value={p.areaId}
              onChange={(e) => update({ areaId: e.target.value })}
            >
              <Options items={areas} />
            </select>
          </label>
          <label>
            Target venue
            <BlurField
              value={p.venue}
              placeholder="Conference or journal name"
              onCommit={(venue) => update({ venue })}
            />
          </label>
        </section>
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <ListTodo size={17} /> Next steps
            </h2>
            <span className="quiet-label">
              {p.tasks.filter((t) => t.done).length} / {p.tasks.length} COMPLETE
            </span>
          </div>
          <div className="detail-tasks">
            {p.tasks.map((t) => (
              <div key={t.id} className={t.done ? "done" : ""}>
                <button
                  className="task-check"
                  aria-label={`${t.done ? "Reopen" : "Complete"} ${t.text}`}
                  onClick={() =>
                    update((latest) => ({
                      tasks: latest.tasks.map((item) =>
                        item.id === t.id ? { ...item, done: !item.done } : item,
                      ),
                    }))
                  }
                >
                  {t.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </button>
                <span className="task-copy">
                  {t.text}
                  {!t.done && (
                    <BlurField
                      aria-label={`Blocker for ${t.text}`}
                      placeholder="Blocker or waiting for…"
                      value={t.blocked || ""}
                      onCommit={(blocked) =>
                        update((latest) => ({
                          tasks: latest.tasks.map((item) =>
                            item.id === t.id ? { ...item, blocked } : item,
                          ),
                        }))
                      }
                    />
                  )}
                </span>
                <button
                  className="button text small"
                  aria-label={`${t.pinned ? "Unpin" : "Pin"} ${t.text}`}
                  aria-pressed={!!t.pinned}
                  onClick={() =>
                    update((latest) => ({
                      tasks: latest.tasks.map((item) =>
                        item.id === t.id
                          ? { ...item, pinned: !item.pinned }
                          : item,
                      ),
                    }))
                  }
                >
                  {t.pinned ? "Pinned" : "Pin for today"}
                </button>
                <button
                  className="icon-button"
                  title="Remove task"
                  aria-label={`Remove ${t.text}`}
                  onClick={() =>
                    update(
                      (latest) => ({
                        tasks: latest.tasks.filter((item) => item.id !== t.id),
                      }),
                      `Removed “${t.text}”`,
                    )
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <TaskAdd
            label="Add a next step"
            add={(text) =>
              update((latest) => ({
                tasks: [
                  ...latest.tasks,
                  { id: crypto.randomUUID(), text, done: false },
                ],
              }))
            }
          />
        </section>
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <NotebookPen size={17} /> Research notes
            </h2>
            <span className="quiet-label">SAVED WHEN YOU LEAVE THE FIELD</span>
          </div>
          <BlurField
            className="notes-input"
            aria-label="Research notes"
            value={p.notes}
            multiline
            rows={8}
            placeholder="Questions, observations, experiment results, reviewer feedback…"
            onCommit={(notes) => update({ notes })}
          />
        </section>
        {(p.links?.length || p.sourceNote) && (
          <section className="detail-card project-sources">
            <div className="section-heading">
              <h2>
                <Library size={17} /> Sources & manuscripts
              </h2>
            </div>
            <div className="project-source-links">
              {p.links?.map((l) => (
                <button
                  key={l.url}
                  className="button small"
                  onClick={() => openExternal(l.url, report)}
                >
                  {l.label}
                  <ExternalLink size={12} />
                </button>
              ))}
            </div>
            {p.sourceNote && <pre>{p.sourceNote}</pre>}
          </section>
        )}
      </div>
      <aside className="details-aside">
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <Milestone size={16} /> Project journey
            </h2>
          </div>
          <div className="journey">
            {stages.map((s, i) => (
              <button
                key={s.id}
                className={
                  i === current ? "current" : i < current ? "past" : ""
                }
                aria-current={i === current ? "step" : undefined}
                onClick={() => update({ stage: s.id })}
              >
                <span>{i < current ? <Check size={11} /> : <i />}</span>
                {s.name}
                {i === current && <small>NOW</small>}
              </button>
            ))}
          </div>
        </section>
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <CalendarDays size={16} /> Paper & milestone dates
            </h2>
          </div>
          {dates.length ? (
            <div className="detail-deadlines">
              {dates.map((d) => (
                <div key={d.key}>
                  <DateBlock time={d.time} />
                  <button
                    className="deadline-detail-main"
                    onClick={() => edit(d)}
                  >
                    <strong>{d.title}</strong>
                    <span>
                      <Urgency
                        time={d.time}
                        now={now}
                        done={d.status === "finished"}
                      />
                      {kindLabel(d.kind)}
                      {d.trackedId && (
                        <span title="Linked from Dates & deadlines">
                          <Link2 size={12} />
                        </span>
                      )}
                    </span>
                  </button>
                  {d.url && (
                    <button
                      className="icon-button"
                      title={`Open source for ${d.title}`}
                      onClick={() => openExternal(d.url!, report)}
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                  {d.deadlineId && (
                    <button
                      className="icon-button"
                      title={`Remove ${d.title}`}
                      onClick={() =>
                        update(
                          (latest) => ({
                            deadlines: latest.deadlines.filter(
                              (item) => item.id !== d.deadlineId,
                            ),
                          }),
                          `Removed “${d.title}”`,
                        )
                      }
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="aside-empty">
              No dates yet. Add an abstract deadline, submission, decision, or
              revision date.
            </p>
          )}
          <button className="button full-width" onClick={() => edit()}>
            <Plus size={14} /> Add milestone
          </button>
        </section>
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <TerminalSquare size={16} /> Workbench setup
            </h2>
          </div>
          <label>
            Project folder
            <div className="folder-field" title={p.folder}>
              {p.folder || "No folder attached"}
            </div>
            <button
              className="button full-width"
              onClick={async () => {
                try {
                  const result = await window.research!.chooseFolder(p.id);
                  if (!result) return;
                  update({ folder: result.folder, mainFile: result.mainFile });
                  setFiles(result.files);
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              <FolderOpen size={14} />{" "}
              {p.folder ? "Change folder" : "Attach folder"}
            </button>
          </label>
          <label>
            LaTeX entry file
            <select
              value={p.mainFile}
              onChange={(e) => update({ mainFile: e.target.value })}
            >
              <option value="">Select .tex file</option>
              {texFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label>
            LaTeX engine
            <select
              value={p.latexEngine || ""}
              onChange={(e) =>
                update({
                  latexEngine: (e.target.value ||
                    undefined) as Project["latexEngine"],
                })
              }
            >
              <option value="">Automatic</option>
              <option value="pdflatex">pdfLaTeX</option>
              <option value="xelatex">XeLaTeX</option>
              <option value="lualatex">LuaLaTeX</option>
            </select>
          </label>
          <p className="form-help">
            Automatic follows a <code>% !TEX program</code> line at the top of
            the entry file, otherwise pdfLaTeX.
          </p>
          <label>
            SSH host <span className="optional">optional</span>
            <BlurField
              value={p.sshHost}
              placeholder="user@host or SSH alias"
              onCommit={(sshHost) => update({ sshHost })}
            />
          </label>
          <p className="form-help">
            Uses your Mac’s SSH config and keys. Change a host, then restart the
            SSH session.
          </p>
        </section>
        <button className="remove-project" onClick={remove}>
          <Trash2 size={13} /> Remove project from workspace
        </button>
      </aside>
    </div>
  );
}
