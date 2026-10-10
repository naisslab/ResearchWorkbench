import { memo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Circle,
  Clock3,
  FileText,
  Folder,
  ListTodo,
  Plus,
  Search,
  TerminalSquare,
} from "lucide-react";
import type {
  Area,
  Navigate,
  Project,
  UpdateProject,
  Workspace,
} from "../types";
import { stageName, stages } from "../types";
import { countdown, dueSoon, type DatedItem } from "../dates";
import { DateBlock, Urgency } from "../ProjectMilestones";
import { AreaIcon, ProjectIcon } from "../ResearchIcons";
import {
  Empty,
  matchesProject,
  Options,
  plural,
  SearchField,
  StageBadge,
  Stat,
} from "../components/ui";

export default memo(function OverviewView({
  state,
  projects: ordered,
  items,
  now,
  area,
  navigate,
  newProject,
  update,
}: {
  state: Workspace;
  projects: Project[];
  items: DatedItem[];
  now: number;
  area: string;
  navigate: Navigate;
  newProject(): void;
  update: UpdateProject;
}) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const areas = new Map(state.areas.map((a) => [a.id, a]));
  const byId = new Map(state.projects.map((p) => [p.id, p]));
  const areaProjects = ordered.filter(
    (p) => area === "all" || p.areaId === area,
  );
  const projects = areaProjects.filter(
    (p) => (stage === "all" || p.stage === stage) && matchesProject(p, query),
  );
  const soon = dueSoon(items, 14, now).filter(
    (d) =>
      area === "all" ||
      d.projectIds.some((id) => byId.get(id)?.areaId === area),
  );
  const withTasks = areaProjects.filter((p) => p.tasks.some((t) => !t.done));
  const filters = [
    query.trim() && `“${query.trim()}”`,
    area !== "all" && areas.get(area)?.name,
    stage !== "all" && stageName[stage as Project["stage"]],
  ].filter(Boolean);
  let recentProject: Project | undefined;
  try {
    const sessions = JSON.parse(
      localStorage.getItem("research-workbench.sessions") || "[]",
    ) as [string, unknown][];
    const id = localStorage.getItem("research-workbench.last-project");
    recentProject =
      areaProjects.find((p) => p.id === id) ||
      areaProjects.find((p) => sessions.some(([id]) => p.id === id));
  } catch {}
  const pinned = areaProjects.flatMap((project) =>
    project.tasks
      .filter((task) => task.pinned && !task.done)
      .map((task) => ({ project, task })),
  );
  return (
    <>
      <section className="today-card">
        <div className="section-heading">
          <h2>Today</h2>
          {recentProject && (
            <button
              className="button small"
              onClick={() =>
                navigate("workbench", { projectId: recentProject.id })
              }
            >
              Continue {recentProject.name} <ArrowRight size={14} />
            </button>
          )}
        </div>
        {pinned.length ? (
          pinned.map(({ project, task }) => (
            <div className="today-task" key={`${project.id}:${task.id}`}>
              <button
                className="task-check"
                aria-label={`Complete pinned ${task.text}`}
                onClick={() =>
                  void update(project.id, (latest) => ({
                    tasks: latest.tasks.map((t) =>
                      t.id === task.id ? { ...t, done: true } : t,
                    ),
                  }))
                }
              >
                <Circle size={17} />
              </button>
              <button
                onClick={() => navigate("details", { projectId: project.id })}
              >
                <strong>{task.text}</strong>
                <small>
                  {project.name}
                  {task.blocked ? ` · Blocked: ${task.blocked}` : ""}
                </small>
              </button>
            </div>
          ))
        ) : (
          <p className="muted">
            Pin next steps in a project to choose what to focus on today.
          </p>
        )}
      </section>
      <div className="stats-grid">
        <Stat
          icon={<FileText size={19} />}
          label="In writing or revision"
          number={
            areaProjects.filter(
              (p) => p.stage === "writing" || p.stage === "revision",
            ).length
          }
          onClick={() => navigate("board")}
        />
        <Stat
          icon={<ListTodo size={19} />}
          label="Open next steps"
          number={withTasks.reduce(
            (n, p) => n + p.tasks.filter((t) => !t.done).length,
            0,
          )}
        />
        <Stat
          icon={<CalendarDays size={19} />}
          label="Due in 7 days"
          number={dueSoon(soon, 7, now).length}
          onClick={() => navigate("deadlines")}
        />
      </div>
      <div className="overview-layout">
        <section className="projects-section">
          <div className="section-heading">
            <h2>
              Your projects <span>{projects.length}</span>
            </h2>
            <select
              aria-label="Filter by stage"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              <option value="all">All stages</option>
              <Options items={stages} />
            </select>
          </div>
          <SearchField
            label="Search projects"
            placeholder="Search projects, ideas, or venues…"
            value={query}
            onChange={setQuery}
          />
          {projects.length ? (
            <div className="project-grid">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  area={areas.get(p.areaId)}
                  next={items.find(
                    (d) => d.upcoming && d.projectIds.includes(p.id),
                  )}
                  now={now}
                  navigate={navigate}
                />
              ))}
            </div>
          ) : areaProjects.length ? (
            <Empty
              icon={<Search size={28} />}
              title="No projects match"
              description={filters.join(" · ")}
              action={
                <button
                  className="button primary"
                  onClick={() => {
                    setQuery("");
                    setStage("all");
                    if (area !== "all") navigate("overview", { area: "all" });
                  }}
                >
                  Clear search and filters
                </button>
              }
            />
          ) : (
            <Empty
              icon={<Folder size={28} />}
              title="Make room for your next idea"
              description="Create a project to start organizing this research area."
              action={
                <button className="button" onClick={newProject}>
                  <Plus size={14} /> New project
                </button>
              }
            />
          )}
        </section>
        <aside className="overview-aside">
          <section className="aside-card">
            <div className="section-heading">
              <h2>
                <CalendarDays size={16} /> Next 14 days
              </h2>
              <button
                className="icon-button"
                title="All deadlines"
                onClick={() => navigate("deadlines")}
              >
                <ArrowRight size={15} />
              </button>
            </div>
            {soon.length ? (
              <div className="upcoming-list">
                {soon.map((d) => {
                  const project = byId.get(d.projectIds[0]);
                  return (
                    <button
                      key={d.key}
                      onClick={() =>
                        project
                          ? navigate("details", { projectId: project.id })
                          : navigate("deadlines")
                      }
                    >
                      <DateBlock time={d.time} />
                      <div className="upcoming-copy">
                        <strong>{d.title}</strong>
                        <span>
                          {project?.name || "Conference & personal dates"}
                        </span>
                      </div>
                      <Urgency time={d.time} now={now} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="aside-empty">Nothing is due in the next 14 days.</p>
            )}
          </section>
          <section className="aside-card">
            <div className="section-heading">
              <h2>
                <ListTodo size={16} /> Next steps
              </h2>
            </div>
            {withTasks.length ? (
              withTasks.map((p) => (
                <div className="focus-group" key={p.id}>
                  <button
                    className="focus-project"
                    onClick={() => navigate("details", { projectId: p.id })}
                  >
                    {p.name}
                  </button>
                  <div className="focus-list">
                    {p.tasks
                      .filter((t) => !t.done)
                      .map((task) => (
                        <div key={task.id}>
                          <button
                            className="task-check"
                            aria-label={`Complete ${task.text}`}
                            onClick={() =>
                              void update(
                                p.id,
                                (latest) => ({
                                  tasks: latest.tasks.map((t) =>
                                    t.id === task.id ? { ...t, done: true } : t,
                                  ),
                                }),
                                `Completed “${task.text}”`,
                              )
                            }
                          >
                            <Circle size={17} />
                          </button>
                          <span className="focus-text">
                            <span>{task.text}</span>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="aside-empty">
                No open tasks. Add next steps inside a project.
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
});

function ProjectCard({
  project: p,
  area,
  next,
  now,
  navigate,
}: {
  project: Project;
  area?: Area;
  next?: DatedItem;
  now: number;
  navigate: Navigate;
}) {
  const open = p.tasks.filter((t) => !t.done).length;
  // The countdown leads, so a long title is what truncates.
  const status = next
    ? `${countdown(next.time, now)} · ${next.title}`
    : p.tasks.length > 0 && plural(open, "open task");
  return (
    <article
      className="project-card"
      style={{ "--area-color": area?.color } as React.CSSProperties}
    >
      <button
        className="project-card-body"
        onClick={() => navigate("details", { projectId: p.id })}
      >
        <div className="card-top">
          <span className="card-area">
            <AreaIcon area={area} size={13} />
            {area?.name}
          </span>
        </div>
        <div className="card-title-row">
          {p.icon && (
            <span className="research-project-icon">
              <ProjectIcon project={p} size={21} />
            </span>
          )}
          <h3>{p.name}</h3>
        </div>
        <p>{p.summary}</p>
        <StageBadge stage={p.stage} />
      </button>
      <div className="project-card-footer">
        {status && (
          <span>
            {next ? <Clock3 size={12} /> : <ListTodo size={12} />}
            <span>{status}</span>
          </span>
        )}
        <button
          onClick={() => navigate("workbench", { projectId: p.id })}
          title={`Open ${p.name} workbench`}
        >
          <TerminalSquare size={13} /> Open workbench <ArrowRight size={12} />
        </button>
      </div>
    </article>
  );
}
