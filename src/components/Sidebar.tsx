import { memo, useLayoutEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  House,
  Library,
  LoaderCircle,
  Plus,
  Settings2,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import type { Area, Navigate, Project, View } from "../types";
import { AreaIcon, ResearchMark } from "../ResearchIcons";

const destinations: [View, string, LucideIcon][] = [
  ["overview", "Overview", House],
  ["board", "Project board", SquareKanban],
  ["deadlines", "Dates & deadlines", CalendarDays],
  ["collection", "Research collection", Library],
];

export default memo(function Sidebar({
  areas,
  projects,
  view,
  selected,
  area,
  rail,
  dueThisWeek,
  agentRuns,
  navigate,
  addProject,
}: {
  areas: Area[];
  projects: Project[];
  view: View;
  selected: string;
  area: string;
  rail: boolean;
  dueThisWeek: number;
  agentRuns: Record<string, "running" | "done" | "failed">;
  navigate: Navigate;
  addProject(areaId: string): void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const tree = useRef<HTMLDivElement>(null);
  const inProject = view === "details" || view === "workbench";
  // The rail marks the area of the open project.
  const projectArea =
    rail && inProject && projects.find((p) => p.id === selected)?.areaId;
  useLayoutEffect(() => {
    tree.current
      ?.querySelector(".area-projects .selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, inProject]);
  return (
    <>
      <div className="mac-title-spacer" />
      <div className="brand">
        <div className="brand-symbol">
          <ResearchMark size={31} />
        </div>
        <div>
          <strong>Research</strong>
          <span>Workbench</span>
        </div>
      </div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav className="main-nav">
        {destinations.map(([id, label, Icon]) => {
          // With an area chosen, the area row is the active one instead.
          const filtered = id === "overview" || id === "board";
          const active = view === id && (!filtered || area === "all");
          return (
            <button
              key={id}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              title={label}
              onClick={() => navigate(id, filtered ? { area: "all" } : {})}
            >
              <Icon size={17} />
              <span>{label}</span>
              {id === "deadlines" && dueThisWeek > 0 && (
                <span className="nav-count" title="Due in the next 7 days">
                  {dueThisWeek}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="nav-section-label research-label">RESEARCH AREAS</div>
      <div className="research-areas" ref={tree}>
        {areas.map((a) => {
          const open = !rail && !collapsed.includes(a.id);
          const list = projects.filter((p) => p.areaId === a.id);
          const active =
            (area === a.id && (view === "overview" || view === "board")) ||
            projectArea === a.id;
          return (
            <section className="area-group" key={a.id}>
              <div className={`area-row ${active ? "active" : ""}`}>
                <button
                  className="collapse-area"
                  aria-label={`Toggle ${a.name}`}
                  aria-expanded={open}
                  onClick={() =>
                    setCollapsed((c) =>
                      c.includes(a.id)
                        ? c.filter((i) => i !== a.id)
                        : [...c, a.id],
                    )
                  }
                >
                  {open ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </button>
                <button
                  className="area-name"
                  aria-label={a.name}
                  aria-current={active ? "true" : undefined}
                  title={a.name}
                  onClick={() =>
                    navigate(view === "board" ? "board" : "overview", {
                      area: a.id,
                    })
                  }
                >
                  <span style={{ color: a.color }}>
                    <AreaIcon area={a} />
                  </span>
                  <span>{a.name}</span>
                </button>
                <span className="area-count">{list.length}</span>
              </div>
              {open && (
                <div className="area-projects">
                  {list.map((p) => {
                    const current = inProject && selected === p.id;
                    const run = agentRuns[p.id];
                    const status =
                      run === "running"
                        ? "Agent working"
                        : run === "failed"
                          ? "Agent stopped with an error"
                          : run
                            ? "Agent finished"
                            : undefined;
                    return (
                      <button
                        key={p.id}
                        className={current ? "selected" : ""}
                        aria-current={current ? "true" : undefined}
                        // The status describes the row without renaming it.
                        aria-description={status}
                        onClick={() =>
                          navigate("workbench", { projectId: p.id })
                        }
                        title={status ? `${p.name} · ${status}` : p.name}
                      >
                        <span className="project-dot" data-stage={p.stage} />
                        <span className="project-name">{p.name}</span>
                        {run === "running" ? (
                          <LoaderCircle
                            size={12}
                            className="spin project-agent"
                            aria-hidden
                          />
                        ) : run ? (
                          <i
                            className={`project-agent-done ${run}`}
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    );
                  })}
                  <button
                    className="add-project-inline"
                    onClick={() => addProject(a.id)}
                  >
                    <Plus size={12} /> Add project
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="sidebar-bottom">
        <button
          className={view === "settings" ? "active" : ""}
          aria-current={view === "settings" ? "page" : undefined}
          aria-label="Workspace settings"
          title="Workspace settings"
          onClick={() => navigate("settings")}
        >
          <Settings2 size={16} /> <span>Workspace settings</span>
        </button>
      </div>
    </>
  );
});
