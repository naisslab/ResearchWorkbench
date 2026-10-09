import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CirclePlus,
  Clock3,
  ExternalLink,
  Folder,
  FolderOpen,
  GitBranch,
  Layers3,
  Library,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
  Moon,
  Sun,
  Monitor,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import type {
  Area,
  Deadline,
  DeadlineKind,
  Project,
  Stage,
  Workspace,
} from "./types";
import { dateLabel, daysUntil, deadlineKinds, dueLabel, stages } from "./types";
import Workbench from "./Workbench";
import PanelDivider from "./PanelDivider";
import { clamp, defaultPanelLayout } from "./panel-layout";
import { usePanelLayout, usePanelSize } from "./usePanelLayout";
import ResearchCollection from "./ResearchCollection";
import DeadlineHub, { localDate, countdown } from "./DeadlineHub";
import { useAppearance } from "./theme";
import { linkedProjectIds, datesForProject } from "./linked-dates";
import { useScrollVisibility } from "./useScrollVisibility";
import { AreaIcon, ProjectIcon, ResearchMark } from "./ResearchIcons";
import { priorityStages, sortProjects } from "./project-order";
const boardStages = priorityStages.map((id) =>
  stages.find((stage) => stage.id === id)!,
);
type View =
  | "overview"
  | "board"
  | "deadlines"
  | "details"
  | "workbench"
  | "settings"
  | "collection";
function StageBadge({ stage }: { stage: Stage }) {
  const item = stages.find((s) => s.id === stage)!;
  return (
    <span className={`stage-badge stage-${stage}`}>
      <i style={{ background: item.color }} />
      {item.name}
    </span>
  );
}
function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export default function App() {
  const { layout, change: changeLayout } = usePanelLayout();
  const [layoutShellRef, shellSize] = usePanelSize();
  const maxSidebar = Math.max(180, Math.min(420, shellSize.width - 750));
  const sidebarWidth = clamp(layout.sidebar, 180, maxSidebar);
  const [state, setState] = useState<Workspace | null>(null);
  const dark = useAppearance(state?.appearance || "system");
  const showScrollbars = useScrollVisibility();
  const stateRef = useRef<Workspace | null>(null);
  const [view, setView] = useState<View>("overview");
  const [areaFilter, setAreaFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [selected, setSelected] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [projectModal, setProjectModal] = useState(false);
  const [deadlineModal, setDeadlineModal] = useState<string | null>(null);
  const [editingDeadline, setEditingDeadline] = useState<
    Deadline | undefined
  >();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("Saved locally");
  const [loadingError, setLoadingError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const saveCounter = useRef(0);
  const report = useCallback(
    (message: string) =>
      setError(
        message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      ),
    [],
  );
  useEffect(() => {
    if (!window.research) {
      setLoadingError(
        "Open this workspace in the desktop app. Run npm run dev from the project folder.",
      );
      return;
    }
    void window.research
      .load()
      .then((data) => {
        stateRef.current = data;
        setState(data);
      })
      .catch((e) => setLoadingError(e.message));
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchOpen((x) => !x);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setProjectModal(false);
        setDeadlineModal(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const commit = useCallback(
    async (transform: (current: Workspace) => Workspace) => {
      if (!stateRef.current) return;
      const previous = stateRef.current;
      const next = transform(previous);
      stateRef.current = next;
      setState(next);
      setSaveStatus("Saving…");
      const revision = ++saveCounter.current;
      try {
        await window.research!.save(next);
        if (revision === saveCounter.current) setSaveStatus("Saved locally");
      } catch (e) {
        setSaveStatus("Save failed");
        report((e as Error).message);
        throw e;
      }
    },
    [report],
  );
  const updateProject = useCallback(
    async (id: string, changes: Partial<Project>) => {
      await commit((current) => ({
        ...current,
        projects: current.projects.map((p) =>
          p.id === id
            ? { ...p, ...changes, updatedAt: new Date().toISOString() }
            : p,
        ),
      }));
    },
    [commit],
  );
  function navigate(next: View, id?: string) {
    const permitted = window.dispatchEvent(
      new Event("research:navigate", { cancelable: true }),
    );
    if (!permitted) return;
    if (id) setSelected(id);
    setView(next);
    setQuery("");
  }
  function chooseArea(
    id: string,
    next: View = view === "board" ? "board" : "overview",
  ) {
    if (
      !window.dispatchEvent(
        new Event("research:navigate", { cancelable: true }),
      )
    )
      return;
    setAreaFilter(id);
    setView(next);
    setQuery("");
  }
  function addDeadline(id: string, deadline?: Deadline) {
    setEditingDeadline(deadline);
    setDeadlineModal(id);
  }
  function receiveWorkspace(next: Workspace) {
    stateRef.current = next;
    setState(next);
    ++saveCounter.current;
    setSaveStatus("Saved locally");
  }
  if (!state)
    return (
      <div className="loading-screen">
        <div className="brand-symbol">
          <ResearchMark size={32} />
        </div>
        <h2>Research Workbench</h2>
        {loadingError ? (
          <p>{loadingError}</p>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );
  const orderProjects = (projects: Project[]) =>
    sortProjects(projects, undefined, state.trackedDeadlines || []);
  const projects = orderProjects(
    state.projects.filter(
      (p) =>
        (areaFilter === "all" || p.areaId === areaFilter) &&
        (stageFilter === "all" || p.stage === stageFilter) &&
        (p.name + " " + p.summary + " " + p.venue)
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
  );
  const project = state.projects.find((p) => p.id === selected);
  const projectDates = state.projects
    .flatMap((p) => p.deadlines.map((d) => ({ ...d, project: p })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const allDates: (Deadline & {
    project?: Project;
    time?: string;
    status?: string;
  })[] = [
    ...projectDates,
    ...(state.trackedDeadlines || []).map((d) => ({
      ...d,
      date: localDate(d.time),
      project: state.projects.find((p) => linkedProjectIds(d).includes(p.id)),
    })),
  ];
  const upcoming = allDates
    .filter(
      (d) =>
        (d.time ? Date.parse(d.time) >= Date.now() : daysUntil(d.date) >= 0) &&
        d.status !== "finished",
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const area = state.areas.find((a) => a.id === areaFilter);
  const activeProjects = state.projects.filter((p) => p.stage !== "published");
  const paperProjects = state.projects.filter((p) =>
    ["writing", "submitted", "revision"].includes(p.stage),
  );
  const focusedProjects = orderProjects(
    state.projects.filter((p) => p.tasks.some((t) => !t.done)),
  ).slice(0, 3);
  const title =
    view === "board"
      ? "Project Board"
      : view === "deadlines"
        ? "Dates & Deadlines"
        : view === "settings"
          ? "Workspace Settings"
          : view === "collection"
            ? "Research Collection"
            : view === "overview"
              ? area?.name || "Research Overview"
              : project?.name || "Research Overview";
  return (
    <div className="app-shell" ref={layoutShellRef}>
      <aside className="sidebar" style={{ width: sidebarWidth }}>
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
        <button
          className="workspace-picker"
          onClick={() => navigate("overview")}
        >
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Personal Workspace</strong>
            <span>Local on this Mac</span>
          </div>
          <ChevronDown size={14} />
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="main-nav">
          <button
            className={
              view === "overview" && areaFilter === "all" ? "active" : ""
            }
            onClick={() => {
              chooseArea("all", "overview");
            }}
          >
            <LayoutDashboard size={17} />
            <span>Overview</span>
            <span className="nav-count">{state.projects.length}</span>
          </button>
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => navigate("board")}
          >
            <LayoutGrid size={17} />
            <span>Project board</span>
          </button>
          <button
            className={view === "deadlines" ? "active" : ""}
            onClick={() => navigate("deadlines")}
          >
            <CalendarDays size={17} />
            <span>Dates & deadlines</span>
            {upcoming.length > 0 && (
              <span className="nav-count">{upcoming.length}</span>
            )}
          </button>
          <button
            className={view === "collection" ? "active" : ""}
            onClick={() => navigate("collection")}
          >
            <Library size={17} />
            <span>Research collection</span>
          </button>
        </nav>
        <div className="nav-section-label research-label">
          RESEARCH AREAS
          <button
            className="icon-button"
            title="Manage research areas"
            onClick={() => navigate("settings")}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="research-areas" onScrollCapture={showScrollbars}>
          {state.areas.map((a) => (
            <section className="area-group" key={a.id}>
              <div
                className={`area-row ${areaFilter === a.id && ["overview", "board"].includes(view) ? "active" : ""}`}
              >
                <button
                  className="collapse-area"
                  aria-label={`Toggle ${a.name}`}
                  onClick={() =>
                    setCollapsed((c) =>
                      c.includes(a.id)
                        ? c.filter((i) => i !== a.id)
                        : [...c, a.id],
                    )
                  }
                >
                  {collapsed.includes(a.id) ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
                <button className="area-name" onClick={() => chooseArea(a.id)}>
                  <span style={{ color: a.color }}>
                    <AreaIcon area={a} />
                  </span>
                  <span>{a.name}</span>
                </button>
                <span className="area-count">
                  {state.projects.filter((p) => p.areaId === a.id).length}
                </span>
              </div>
              {!collapsed.includes(a.id) && (
                <div className="area-projects">
                  {orderProjects(
                    state.projects.filter((p) => p.areaId === a.id),
                  ).map((p) => (
                    <button
                      key={p.id}
                      className={
                        selected === p.id &&
                        ["details", "workbench"].includes(view)
                          ? "selected"
                          : ""
                      }
                      onClick={() => navigate("workbench", p.id)}
                      title={p.name}
                    >
                      <span
                        className={`project-dot stage-dot-${p.stage}`}
                        style={{
                          background: stages.find((s) => s.id === p.stage)
                            ?.color,
                        }}
                      />
                      <span>{p.name}</span>
                    </button>
                  ))}
                  <button
                    className="add-project-inline"
                    onClick={() => {
                      setAreaFilter(a.id);
                      setProjectModal(true);
                    }}
                  >
                    <Plus size={12} /> Add project
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <i className="live-dot" />
            <span>{saveStatus}</span>
            <span className="local-lock">LOCAL</span>
          </div>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={16} /> Workspace settings
          </button>
        </div>
      </aside>
      <PanelDivider
        label="Resize research sidebar"
        value={sidebarWidth}
        min={180}
        max={maxSidebar}
        change={(sidebar) => changeLayout({ sidebar })}
        reset={() => changeLayout({ sidebar: defaultPanelLayout.sidebar })}
      />
      <main className="main">
        <header className="app-header">
          <div className="header-location">
            <ResearchMark size={19} />
            <span>Personal Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {["workbench", "details"].includes(view) ? "Projects" : title}
            </strong>
          </div>
          <button className="global-search" onClick={() => setSearchOpen(true)}>
            <Search size={14} />
            <span>Find a project…</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="icon-button theme-toggle"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() =>
              void commit((s) => ({
                ...s,
                appearance: dark ? "light" : "dark",
              })).catch(() => {})
            }
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <span className="header-date">
            {new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        </header>
        {view === "workbench" && project ? (
          <Workbench
            key={project.id}
            project={project}
            update={(changes) => updateProject(project.id, changes)}
            report={report}
            details={() => navigate("details", project.id)}
            layout={layout}
            changeLayout={changeLayout}
          />
        ) : (
          <div className="page-scroll">
            <div className="page-content">
              <div className="page-heading">
                <div>
                  <div
                    className={`eyebrow ${view === "overview" ? "overview-eyebrow" : ""}`}
                  >
                    {view === "overview"
                      ? "RESEARCH WORKSPACE"
                      : view === "details"
                        ? state.areas.find((a) => a.id === project?.areaId)
                            ?.name
                        : "PERSONAL WORKSPACE"}
                  </div>
                  <h1>{title}</h1>
                  <p>
                    {view === "overview"
                      ? "Projects, manuscripts, and milestones across your research areas."
                      : view === "board"
                        ? "Track projects from idea exploration through publication."
                        : view === "deadlines"
                          ? "Submissions, decisions, and the milestones in between."
                          : view === "settings"
                            ? "Organize your research areas and keep a copy of your workspace."
                            : view === "collection"
                              ? "Choose the research projects you want in your workbench."
                              : project?.summary}
                  </p>
                </div>
                <div className="page-heading-actions">
                  {view === "details" && project ? (
                    <button
                      className="button primary"
                      onClick={() => navigate("workbench", project.id)}
                    >
                      <TerminalSquare size={16} /> Open workbench{" "}
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    view !== "settings" &&
                    view !== "deadlines" &&
                    view !== "collection" && (
                      <button
                        className="button primary"
                        onClick={() => setProjectModal(true)}
                      >
                        <Plus size={16} /> New project
                      </button>
                    )
                  )}
                </div>
              </div>
              {view === "overview" && (
                <>
                  {!state.projects.some((p) => p.catalogId) && (
                    <button
                      className="research-collection-banner"
                      onClick={() => navigate("collection")}
                    >
                      <Library size={21} />
                      <div>
                        <strong>Bring your research into the workbench</strong>
                        <span>
                          Browse projects from your websites, local manuscripts
                          and Overleaf.
                        </span>
                      </div>
                      <ArrowRight size={17} />
                    </button>
                  )}
                  <div className="stats-grid">
                    <Stat
                      icon={<FolderOpen size={19} />}
                      label="Active projects"
                      number={
                        areaFilter === "all"
                          ? activeProjects.length
                          : projects.filter((p) => p.stage !== "published")
                              .length
                      }
                      detail="Across your research areas"
                    />
                    <Stat
                      icon={<FileIcon />}
                      label="Papers in progress"
                      number={
                        areaFilter === "all"
                          ? paperProjects.length
                          : projects.filter((p) =>
                              ["writing", "submitted", "revision"].includes(
                                p.stage,
                              ),
                            ).length
                      }
                      detail="Writing, review & revision"
                    />
                    <Stat
                      icon={<CalendarDays size={19} />}
                      label="Upcoming dates"
                      number={
                        upcoming.filter(
                          (d) =>
                            areaFilter === "all" ||
                            d.project?.areaId === areaFilter,
                        ).length
                      }
                      detail="Submissions & decisions"
                    />
                  </div>
                  <div className="overview-layout">
                    <section className="projects-section">
                      <div className="section-heading">
                        <h2>
                          Your projects <span>{projects.length}</span>
                        </h2>
                        <div className="section-actions">
                          <button
                            className="icon-button"
                            title="Project board"
                            onClick={() => navigate("board")}
                          >
                            <LayoutGrid size={16} />
                          </button>
                          <select
                            aria-label="Filter by stage"
                            value={stageFilter}
                            onChange={(e) => setStageFilter(e.target.value)}
                          >
                            <option value="all">All stages</option>
                            {stages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="projects-search">
                        <Search size={14} />
                        <input
                          aria-label="Search projects"
                          placeholder="Search projects, ideas, or venues…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                          <button
                            className="icon-button"
                            onClick={() => setQuery("")}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      {projects.length ? (
                        <div className="project-grid">
                          {projects.map((p) => (
                            <ProjectCard
                              key={p.id}
                              project={p}
                              linkedDates={datesForProject(
                                state.trackedDeadlines || [],
                                p.id,
                              )}
                              area={state.areas.find((a) => a.id === p.areaId)!}
                              open={() => navigate("details", p.id)}
                              workbench={() => navigate("workbench", p.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <Empty
                          icon={<Folder size={28} />}
                          title="Make room for your next idea"
                          description={
                            query
                              ? "No projects match this search."
                              : "Create a project to start organizing this research area."
                          }
                          action={
                            <button
                              className="button"
                              onClick={() => setProjectModal(true)}
                            >
                              <Plus size={14} /> New project
                            </button>
                          }
                        />
                      )}
                      <div className="overview-footnote">
                        <Sparkles size={14} />
                        {state.projects.some((p) => p.example)
                          ? "Example projects are included to explore the workflow. Replace them with your own research."
                          : "Your workspace stays on this Mac. Export a backup from workspace settings."}
                      </div>
                    </section>
                    <aside className="overview-aside">
                      <section className="aside-card">
                        <div className="section-heading">
                          <h2>
                            <CalendarDays size={16} /> Upcoming milestones
                          </h2>
                          <button
                            className="icon-button"
                            title="All deadlines"
                            onClick={() => navigate("deadlines")}
                          >
                            <ArrowRight size={15} />
                          </button>
                        </div>
                        {upcoming.filter(
                          (d) =>
                            areaFilter === "all" ||
                            d.project?.areaId === areaFilter,
                        ).length ? (
                          <div className="upcoming-list">
                            {upcoming
                              .filter(
                                (d) =>
                                  areaFilter === "all" ||
                                  d.project?.areaId === areaFilter,
                              )
                              .slice(0, 4)
                              .map((d) => (
                                <button
                                  key={d.id}
                                  onClick={() =>
                                    d.project
                                      ? navigate("details", d.project.id)
                                      : navigate("deadlines")
                                  }
                                >
                                  <div className="date-square">
                                    <span>
                                      {new Date(
                                        d.date + "T12:00:00",
                                      ).toLocaleDateString("en-US", {
                                        month: "short",
                                      })}
                                    </span>
                                    <strong>{d.date.slice(-2)}</strong>
                                  </div>
                                  <div>
                                    <strong>{d.label}</strong>
                                    <span>
                                      {d.project?.name ||
                                        "Conference & personal dates"}
                                    </span>
                                    <small>
                                      {d.time
                                        ? countdown(d.time)
                                        : dueLabel(d.date)}
                                    </small>
                                  </div>
                                </button>
                              ))}
                          </div>
                        ) : (
                          <div className="horizon-empty">
                            <div className="calendar-illustration">
                              <CalendarDays size={29} strokeWidth={1.3} />
                              <i />
                            </div>
                            <h3>No upcoming dates</h3>
                            <p>
                              Add a submission or decision date
                              <br />
                              to track your next milestone.
                            </p>
                            <button
                              className="button text"
                              onClick={() => navigate("deadlines")}
                            >
                              Add your first date <ArrowRight size={13} />
                            </button>
                          </div>
                        )}
                      </section>
                      <section className="aside-card focus-card">
                        <div className="section-heading">
                          <h2>
                            <ListTodo size={16} /> Next steps
                          </h2>
                          <span className="quiet-label">YOUR FOCUS</span>
                        </div>
                        {focusedProjects.length ? (
                          <div className="focus-list">
                            {focusedProjects.map((p) => {
                              const task = p.tasks.find((t) => !t.done)!;
                              return (
                                <div key={p.id}>
                                  <button
                                    className="task-check"
                                    aria-label={`Complete ${task.text}`}
                                    onClick={() =>
                                      void updateProject(p.id, {
                                        tasks: p.tasks.map((t) =>
                                          t.id === task.id
                                            ? { ...t, done: true }
                                            : t,
                                        ),
                                      }).catch(() => {})
                                    }
                                  >
                                    <Circle size={17} />
                                  </button>
                                  <button
                                    className="focus-text"
                                    onClick={() => navigate("details", p.id)}
                                  >
                                    <span>{task.text}</span>
                                    <small>{p.name}</small>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="aside-empty">
                            No open tasks. Add next steps inside a project.
                          </p>
                        )}
                      </section>
                      <div className="workspace-tip">
                        <div className="tip-symbol">
                          <GitBranch size={19} />
                        </div>
                        <div>
                          <strong>Project workbench</strong>
                          <p>
                            Edit your manuscript, read PDFs, and run experiments
                            in one workspace.
                          </p>
                          <button
                            onClick={() =>
                              project || state.projects[0]
                                ? navigate(
                                    "workbench",
                                    (project || state.projects[0]).id,
                                  )
                                : setProjectModal(true)
                            }
                          >
                            Open a workbench <ArrowRight size={12} />
                          </button>
                        </div>
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {view === "board" && (
                <>
                  <FilterBar
                    areas={state.areas}
                    value={areaFilter}
                    change={setAreaFilter}
                  />
                  <div className="board">
                    {boardStages.map((stage) => {
                      const list = orderProjects(
                        state.projects.filter(
                          (p) =>
                            p.stage === stage.id &&
                            (areaFilter === "all" || p.areaId === areaFilter),
                        ),
                      );
                      return (
                        <section
                          className="board-column"
                          key={stage.id}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id =
                              e.dataTransfer.getData("text/project-id");
                            if (state.projects.some((p) => p.id === id))
                              void updateProject(id, { stage: stage.id }).catch(
                                () => {},
                              );
                          }}
                        >
                          <div className="board-heading">
                            <i style={{ background: stage.color }} />
                            <h3>{stage.name}</h3>
                            <span>{list.length}</span>
                          </div>
                          <div className="board-cards">
                            {list.map((p) => (
                              <div
                                className="board-card"
                                draggable
                                key={p.id}
                                onDragStart={(e) =>
                                  e.dataTransfer.setData(
                                    "text/project-id",
                                    p.id,
                                  )
                                }
                              >
                                <button
                                  className="board-card-main"
                                  onClick={() => navigate("details", p.id)}
                                >
                                  <span
                                    className="card-area"
                                    style={{
                                      color: state.areas.find(
                                        (a) => a.id === p.areaId,
                                      )?.color,
                                    }}
                                  >
                                    {
                                      state.areas.find((a) => a.id === p.areaId)
                                        ?.name
                                    }
                                  </span>
                                  <h3>{p.name}</h3>
                                  <p>{p.summary}</p>
                                  {p.example && (
                                    <span className="sample-tag">EXAMPLE</span>
                                  )}
                                </button>
                                <div className="board-card-footer">
                                  <span>
                                    <ListTodo size={12} />
                                    {p.tasks.filter((t) => t.done).length}/
                                    {p.tasks.length}
                                  </span>
                                  <select
                                    aria-label={`Stage for ${p.name}`}
                                    value={p.stage}
                                    onChange={(e) =>
                                      void updateProject(p.id, {
                                        stage: e.target.value as Stage,
                                      }).catch(() => {})
                                    }
                                  >
                                    {stages.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ))}
                            {!list.length && (
                              <div className="board-drop-zone">
                                Drop a project here
                              </div>
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <p className="board-help">
                    Drag projects between stages, or use the stage menu on a
                    card.
                  </p>
                </>
              )}
              {view === "deadlines" && (
                <DeadlineHub
                  state={state}
                  commit={commit}
                  received={receiveWorkspace}
                  report={report}
                  notify={setNotice}
                  openProject={(id) => navigate("details", id)}
                  projectMilestones={(editDate) => (
                    <DeadlineView
                      projects={state.projects}
                      areas={state.areas}
                      dates={[
                        ...projectDates,
                        ...(state.trackedDeadlines || []).flatMap((d) =>
                          state.projects
                            .filter((p) => linkedProjectIds(d).includes(p.id))
                            .map((p) => ({
                              ...d,
                              id: `${d.id}:${p.id}`,
                              linkedId: d.id,
                              date: localDate(d.time),
                              project: p,
                            })),
                        ),
                      ]}
                      editTracked={editDate}
                      open={(id) => navigate("details", id)}
                      add={addDeadline}
                      update={updateProject}
                    />
                  )}
                />
              )}
              {view === "details" && project && (
                <ProjectDetails
                  key={project.id}
                  project={project}
                  linkedDates={datesForProject(
                    state.trackedDeadlines || [],
                    project.id,
                  )}
                  areas={state.areas}
                  update={(changes) => updateProject(project.id, changes)}
                  addDeadline={(deadline) => addDeadline(project.id, deadline)}
                  report={report}
                  remove={async () => {
                    if (
                      !window.confirm(
                        `Remove “${project.name}” from the workspace? Its files will remain on disk.`,
                      )
                    )
                      return;
                    await commit((current) => ({
                      ...current,
                      projects: current.projects.filter(
                        (p) => p.id !== project.id,
                      ),
                    }));
                    navigate("overview");
                  }}
                />
              )}
              {view === "collection" && (
                <ResearchCollection
                  state={state}
                  report={report}
                  added={(next, count) => {
                    stateRef.current = next;
                    setState(next);
                    ++saveCounter.current;
                    setSaveStatus("Saved locally");
                    setNotice(
                      `${count} research projects added. Existing projects preserved.`,
                    );
                    setAreaFilter("all");
                    navigate("board");
                  }}
                />
              )}
              {view === "settings" && (
                <Settings
                  state={state}
                  commit={commit}
                  report={report}
                  notify={setNotice}
                  imported={(next) => {
                    stateRef.current = next;
                    setState(next);
                    setSelected("");
                    setAreaFilter("all");
                  }}
                />
              )}
            </div>
          </div>
        )}
        <footer className="app-status">
          <span>
            <i className="live-dot" /> {saveStatus}
          </span>
          <span>
            {view === "workbench"
              ? "⌘S Save manuscript"
              : `${state.areas.length} research areas · ${state.projects.length} projects`}
            <span className="status-separator">|</span>Research Workbench{" "}
            <span className="version">v0.1</span>
          </span>
        </footer>
      </main>
      {projectModal && (
        <NewProject
          areas={state.areas}
          areaId={areaFilter === "all" ? state.areas[0]?.id : areaFilter}
          close={() => setProjectModal(false)}
          submit={async (p) => {
            await commit((current) => ({
              ...current,
              projects: [...current.projects, p],
            }));
            setProjectModal(false);
            navigate("details", p.id);
          }}
          report={report}
        />
      )}
      {deadlineModal && (
        <DeadlineModal
          project={state.projects.find((p) => p.id === deadlineModal)!}
          deadline={editingDeadline}
          close={() => setDeadlineModal(null)}
          submit={async (d) => {
            const p = stateRef.current!.projects.find(
              (p) => p.id === deadlineModal,
            )!;
            await updateProject(p.id, {
              deadlines: editingDeadline
                ? p.deadlines.map((item) => (item.id === d.id ? d : item))
                : [...p.deadlines, d],
            });
            setDeadlineModal(null);
          }}
          report={report}
        />
      )}
      {searchOpen && (
        <div
          className="modal-backdrop search-backdrop"
          onClick={() => setSearchOpen(false)}
        >
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="search-modal-input">
              <Search size={19} />
              <input
                autoFocus
                aria-label="Find a project"
                placeholder="Find a project…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <kbd onClick={() => setSearchOpen(false)}>esc</kbd>
            </div>
            <div className="search-results">
              {state.projects
                .filter((p) =>
                  (p.name + " " + p.summary)
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
                )
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSearchOpen(false);
                      navigate("workbench", p.id);
                    }}
                  >
                    <Folder size={17} />
                    <div>
                      <strong>{p.name}</strong>
                      <span>
                        {state.areas.find((a) => a.id === p.areaId)?.name}
                      </span>
                    </div>
                    <StageBadge stage={p.stage} />
                    <ArrowRight size={14} />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="toast error-toast" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
function FileIcon() {
  return <ListTodo size={19} />;
}
function Stat({
  icon,
  label,
  number,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  number: number;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-icon">{icon}</span>
      <div className="stat-copy">
        <div className="stat-label">{label}</div>
        <div className="stat-detail">{detail}</div>
      </div>
      <div className="stat-value">{number}</div>
    </div>
  );
}
function ProjectCard({
  project: p,
  linkedDates,
  area,
  open,
  workbench,
}: {
  project: Project;
  area: Area;
  linkedDates: import("./types").TrackedDeadline[];
  open(): void;
  workbench(): void;
}) {
  const next = [
    ...p.deadlines,
    ...linkedDates
      .filter(
        (d) => d.status !== "finished" && Date.parse(d.time) >= Date.now(),
      )
      .map((d) => ({ ...d, date: localDate(d.time) })),
  ]
    .filter((d) => daysUntil(d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return (
    <article
      className="project-card"
      style={{ "--area-color": area.color } as React.CSSProperties}
    >
      <button className="project-card-body" onClick={open}>
        <div className="card-top">
          <span className="card-area">
            <AreaIcon area={area} size={13} />
            {area.name}
          </span>
          {p.example && <span className="sample-tag">EXAMPLE</span>}
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
        <span>
          {next ? (
            <>
              <Clock3 size={12} />
              {next.label} · {dueLabel(next.date)}
            </>
          ) : (
            <>
              <ListTodo size={12} />
              {p.tasks.filter((t) => !t.done).length} open{" "}
              {p.tasks.filter((t) => !t.done).length === 1 ? "task" : "tasks"}
            </>
          )}
        </span>
        <button onClick={workbench} title={`Open ${p.name} workbench`}>
          <TerminalSquare size={13} /> Open <ArrowRight size={12} />
        </button>
      </div>
    </article>
  );
}
function FilterBar({
  areas,
  value,
  change,
}: {
  areas: Area[];
  value: string;
  change(id: string): void;
}) {
  return (
    <div className="filter-bar">
      <button
        className={value === "all" ? "active" : ""}
        onClick={() => change("all")}
      >
        All research
      </button>
      {areas.map((a) => (
        <button
          key={a.id}
          className={value === a.id ? "active" : ""}
          onClick={() => change(a.id)}
        >
          <i style={{ background: a.color }} />
          {a.name}
        </button>
      ))}
    </div>
  );
}
function NewProject({
  areas,
  areaId,
  close,
  submit,
  report,
}: {
  areas: Area[];
  areaId: string;
  close(): void;
  submit(p: Project): Promise<void>;
  report(s: string): void;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [area, setArea] = useState(areaId);
  const [stage, setStage] = useState<Stage>("exploration");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await submit({
              id: crypto.randomUUID(),
              name: name.trim(),
              summary,
              areaId: area,
              stage,
              folder: "",
              mainFile: "",
              sshHost: "",
              venue: "",
              notes: "",
              tasks: [],
              deadlines: [],
              updatedAt: new Date().toISOString(),
            });
          } catch (error) {
            report((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-heading">
          <div className="modal-icon">
            <FolderPlusIcon />
          </div>
          <button className="icon-button" type="button" onClick={close}>
            <X size={19} />
          </button>
        </div>
        <h2>A place for your next idea</h2>
        <p className="muted">
          Start a project. Add files, tasks, and paper dates as it grows.
        </p>
        <label>
          Project name
          <input
            autoFocus
            placeholder="e.g. Learning to Schedule"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label>
          Research question or short description
          <textarea
            placeholder="What are you trying to understand or build?"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
          />
        </label>
        <div className="form-grid">
          <label>
            Research area
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              required
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Current stage
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as Stage)}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !name.trim() || !area}
          >
            {busy ? "Creating…" : "Create project"}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
function FolderPlusIcon() {
  return <CirclePlus size={24} />;
}
function DeadlineModal({
  project,
  deadline,
  close,
  submit,
  report,
}: {
  project: Project;
  deadline?: Deadline;
  close(): void;
  submit(d: Deadline): Promise<void>;
  report(s: string): void;
}) {
  const [label, setLabel] = useState(deadline?.label || "");
  const [date, setDate] = useState(deadline?.date || "");
  const [kind, setKind] = useState<DeadlineKind>(
    deadline?.kind || "submission",
  );
  const [url, setUrl] = useState(deadline?.url || "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await submit({
              id: deadline?.id || crypto.randomUUID(),
              label: label.trim(),
              date,
              kind,
              url: url || undefined,
            });
          } catch (error) {
            report((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-heading">
          <div className="modal-icon">
            <CalendarDays size={24} />
          </div>
          <button className="icon-button" type="button" onClick={close}>
            <X size={19} />
          </button>
        </div>
        <h2>{deadline ? "Edit milestone" : "Keep a date in sight"}</h2>
        <p className="muted">{project.name}</p>
        <label>
          Milestone name
          <input
            autoFocus
            placeholder="e.g. Conference paper submission"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
        </label>
        <div className="form-grid">
          <label>
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DeadlineKind)}
            >
              {deadlineKinds.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
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
        <p className="form-help">
          Dates are calendar-day reminders. Check the venue’s exact time and
          timezone on its CFP.
        </p>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !label.trim() || !date}
          >
            {deadline ? "Save changes" : "Add milestone"}
          </button>
        </div>
      </form>
    </div>
  );
}
function ProjectDetails({
  project: p,
  linkedDates,
  areas,
  update,
  addDeadline,
  report,
  remove,
}: {
  project: Project;
  linkedDates: import("./types").TrackedDeadline[];
  areas: Area[];
  update(c: Partial<Project>): Promise<void>;
  addDeadline(d?: Deadline): void;
  report(s: string): void;
  remove(): Promise<void>;
}) {
  const [task, setTask] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState(p.name);
  const [summary, setSummary] = useState(p.summary);
  const [notes, setNotes] = useState(p.notes);
  const [venue, setVenue] = useState(p.venue);
  const [ssh, setSsh] = useState(p.sshHost);
  useEffect(() => {
    void window.research
      ?.listFiles(p.id)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [p.id, p.folder]);
  const change = (value: Partial<Project>) =>
    void update(value).catch(() => {});
  return (
    <div className="details-layout">
      <div className="details-main">
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <FolderOpen size={17} /> Project identity
            </h2>
            {p.example && <span className="sample-tag">EXAMPLE PROJECT</span>}
          </div>
          <label>
            Project name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim()) change({ name: name.trim() });
                else setName(p.name);
              }}
            />
          </label>
          <label>
            Research question or description
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onBlur={() => change({ summary })}
              rows={3}
            />
          </label>
          <div className="form-grid">
            <label>
              Research area
              <select
                value={p.areaId}
                onChange={(e) => change({ areaId: e.target.value })}
              >
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Current stage
              <select
                value={p.stage}
                onChange={(e) => change({ stage: e.target.value as Stage })}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Target venue
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              onBlur={() => change({ venue })}
              placeholder="Conference or journal name"
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
                    change({
                      tasks: p.tasks.map((item) =>
                        item.id === t.id ? { ...item, done: !item.done } : item,
                      ),
                    })
                  }
                >
                  {t.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </button>
                <span>{t.text}</span>
                <button
                  className="icon-button"
                  title="Remove task"
                  onClick={() =>
                    change({
                      tasks: p.tasks.filter((item) => item.id !== t.id),
                    })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <form
            className="task-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!task.trim()) return;
              change({
                tasks: [
                  ...p.tasks,
                  { id: crypto.randomUUID(), text: task.trim(), done: false },
                ],
              });
              setTask("");
            }}
          >
            <Plus size={15} />
            <input
              aria-label="Add a next step"
              placeholder="Add a concrete next step…"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            />
            <button className="button small" disabled={!task.trim()}>
              Add
            </button>
          </form>
        </section>
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <FileIcon /> Research notes
            </h2>
            <span className="quiet-label">SAVED WHEN YOU LEAVE THE FIELD</span>
          </div>
          <textarea
            className="notes-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => change({ notes })}
            placeholder="Questions, observations, experiment results, reviewer feedback…"
            rows={8}
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
              {p.links?.map((link) => (
                <button
                  key={link.url}
                  className="button small"
                  onClick={() =>
                    void window
                      .research!.openLink(link.url)
                      .catch((e) => report(e.message))
                  }
                >
                  {link.label}
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
              <GitBranch size={16} /> Project journey
            </h2>
          </div>
          <div className="journey">
            {stages.map((s, i) => (
              <button
                key={s.id}
                className={
                  p.stage === s.id
                    ? "current"
                    : i < stages.findIndex((s) => s.id === p.stage)
                      ? "past"
                      : ""
                }
                onClick={() => change({ stage: s.id })}
              >
                <span>
                  {i < stages.findIndex((s) => s.id === p.stage) ? (
                    <Check size={11} />
                  ) : (
                    <i />
                  )}
                </span>
                {s.name}
                {p.stage === s.id && <small>NOW</small>}
              </button>
            ))}
          </div>
        </section>
        <section className="detail-card">
          <div className="section-heading">
            <h2>
              <CalendarDays size={16} /> Paper & milestone dates
            </h2>
            <button
              className="icon-button"
              title="Add milestone"
              onClick={() => addDeadline()}
            >
              <Plus size={16} />
            </button>
          </div>
          {linkedDates.length > 0 && (
            <div className="detail-deadlines linked-conference-dates">
              {linkedDates.map((d) => (
                <div key={d.id}>
                  <div className="deadline-detail-main">
                    <strong>{d.label}</strong>
                    <span>
                      {new Date(d.time).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })}
                    </span>
                    <small>
                      {d.status === "finished"
                        ? "Finished"
                        : "Linked from Dates & deadlines"}
                    </small>
                  </div>
                  {d.url && (
                    <button
                      className="icon-button"
                      title="Open conference source"
                      onClick={() => void window.research!.openLink(d.url!)}
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {p.deadlines.length ? (
            <div className="detail-deadlines">
              {[...p.deadlines]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((d) => (
                  <div key={d.id}>
                    <button
                      className="deadline-detail-main"
                      onClick={() => addDeadline(d)}
                    >
                      <strong>{d.label}</strong>
                      <span>
                        {dateLabel(d.date)}
                        <small
                          className={daysUntil(d.date) < 0 ? "past-date" : ""}
                        >
                          {dueLabel(d.date)}
                        </small>
                      </span>
                    </button>
                    {d.url && (
                      <button
                        className="icon-button"
                        title="Open deadline source"
                        onClick={() =>
                          void window.research
                            ?.openLink(d.url!)
                            .catch((e) => report(e.message))
                        }
                      >
                        <ExternalLink size={13} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      title="Remove milestone"
                      onClick={() =>
                        change({
                          deadlines: p.deadlines.filter(
                            (item) => item.id !== d.id,
                          ),
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
            </div>
          ) : !linkedDates.length ? (
            <p className="aside-empty">
              No dates yet. Add an abstract deadline, submission, decision, or
              revision date.
            </p>
          ) : null}
          <button className="button full-width" onClick={() => addDeadline()}>
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
                  if (result) {
                    await update({
                      folder: result.folder,
                      mainFile: result.files.includes("main.tex")
                        ? "main.tex"
                        : result.files.find((f) => f.endsWith(".tex")) || "",
                    });
                    setFiles(result.files);
                  }
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
              onChange={(e) => change({ mainFile: e.target.value })}
            >
              <option value="">Select .tex file</option>
              {files
                .filter((f) => f.endsWith(".tex"))
                .map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
            </select>
          </label>
          <label>
            SSH host <span className="optional">optional</span>
            <input
              value={ssh}
              onChange={(e) => setSsh(e.target.value)}
              onBlur={() => change({ sshHost: ssh.trim() })}
              placeholder="user@host or SSH alias"
            />
          </label>
          <p className="form-help">
            Uses your Mac’s SSH config and keys. Change a host, then restart the
            SSH session.
          </p>
        </section>
        <button
          className="remove-project"
          onClick={() => void remove().catch((e) => report(e.message))}
        >
          <Trash2 size={13} /> Remove project from workspace
        </button>
      </aside>
    </div>
  );
}
function DeadlineView({
  projects,
  areas,
  dates,
  open,
  add,
  update,
  editTracked,
}: {
  projects: Project[];
  areas: Area[];
  dates: (Deadline & { project: Project; linkedId?: string })[];
  editTracked(id: string): void;
  open(id: string): void;
  add(id: string, d?: Deadline): void;
  update(id: string, c: Partial<Project>): Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [showPast, setShowPast] = useState(false);
  const [pick, setPick] = useState(false);
  const filtered = dates.filter(
    (d) =>
      (filter === "all" || d.project.areaId === filter) &&
      (showPast || daysUntil(d.date) >= 0),
  );
  return (
    <>
      <div className="deadline-toolbar">
        <FilterBar areas={areas} value={filter} change={setFilter} />
        <div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => setShowPast(e.target.checked)}
            />{" "}
            Include past dates
          </label>
          <button
            className="button"
            disabled={!projects.length}
            onClick={() => setPick((x) => !x)}
          >
            <Plus size={14} /> Add milestone
          </button>
        </div>
      </div>
      {pick && (
        <div className="pick-project">
          <span>Choose a project</span>
          {projects.map((p) => (
            <button
              className="button small"
              key={p.id}
              onClick={() => {
                add(p.id);
                setPick(false);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      {filtered.length ? (
        <div className="deadline-table">
          <div className="deadline-table-head">
            <span>DATE</span>
            <span>MILESTONE & PROJECT</span>
            <span>TYPE</span>
            <span>COUNTDOWN</span>
            <span />
          </div>
          {filtered.map((d) => (
            <div className="deadline-table-row" key={d.id}>
              <div className="deadline-date">
                <strong>
                  {new Date(d.date + "T12:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </strong>
                <span>{d.date.slice(0, 4)}</span>
              </div>
              <button
                className="deadline-project"
                onClick={() => open(d.project.id)}
              >
                <strong>{d.label}</strong>
                <span>
                  <i
                    style={{
                      background: areas.find((a) => a.id === d.project.areaId)
                        ?.color,
                    }}
                  />
                  {d.project.name}
                  {d.project.venue && ` · ${d.project.venue}`}
                </span>
              </button>
              <span className="kind-badge">
                {deadlineKinds.find((k) => k.id === d.kind)?.name}
              </span>
              <span
                className={`countdown ${daysUntil(d.date) <= 7 && daysUntil(d.date) >= 0 ? "soon" : ""}`}
              >
                {dueLabel(d.date)}
              </span>
              <div className="deadline-row-actions">
                <button
                  className="button text small"
                  onClick={() =>
                    d.linkedId ? editTracked(d.linkedId) : add(d.project.id, d)
                  }
                >
                  Edit
                </button>
                {d.url && (
                  <button
                    className="icon-button"
                    title="Open source"
                    onClick={() => void window.research?.openLink(d.url!)}
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
                <button
                  className="icon-button"
                  title="Remove milestone"
                  disabled={!!d.linkedId}
                  onClick={() =>
                    void update(d.project.id, {
                      deadlines: d.project.deadlines.filter(
                        (item) => item.id !== d.id,
                      ),
                    }).catch(() => {})
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<CalendarDays size={34} strokeWidth={1.3} />}
          title="Your next milestone starts here"
          description="Add paper submissions, review decisions, revisions, or project milestones. They will appear here across all your research areas."
          action={
            <button
              className="button primary"
              disabled={!projects.length}
              onClick={() => setPick(true)}
            >
              <Plus size={15} /> Add a milestone
            </button>
          }
        />
      )}
      <div className="date-note">
        <Clock3 size={15} />
        <p>
          Dates are entered by you, with optional source links. The app shows
          calendar-day countdowns; confirm exact submission times and timezones
          with the venue.
        </p>
      </div>
    </>
  );
}
function Settings({
  state,
  commit,
  report,
  notify,
  imported,
}: {
  state: Workspace;
  commit(t: (s: Workspace) => Workspace): Promise<void>;
  report(s: string): void;
  notify(s: string): void;
  imported(s: Workspace): void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#75a6d9");
  const [info, setInfo] = useState<{ dataPath: string; version: string }>();
  useEffect(() => {
    void window.research?.info().then(setInfo);
  }, []);
  return (
    <div className="settings-layout">
      <section className="detail-card appearance-card">
        <div className="section-heading">
          <h2>
            <Sun size={17} />
            Appearance
          </h2>
        </div>
        <p className="muted">
          Choose a theme for the workspace, editor and terminal.
        </p>
        <div className="appearance-options">
          {[
            { id: "light", name: "Light", icon: Sun },
            { id: "dark", name: "Dark", icon: Moon },
            { id: "system", name: "System", icon: Monitor },
          ].map(({ id, name, icon: Glyph }) => (
            <button
              key={id}
              aria-pressed={(state.appearance || "system") === id}
              className={`appearance-option appearance-${id}`}
              onClick={() =>
                void commit((s) => ({
                  ...s,
                  appearance: id as Workspace["appearance"],
                })).catch(() => {})
              }
            >
              <div className="appearance-preview">
                <i />
                <div>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <span>
                <Glyph size={14} />
                {name}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="detail-card">
        <div className="section-heading">
          <h2>
            <Layers3 size={17} /> Research areas
          </h2>
        </div>
        <p className="muted">
          Organize projects around your research interests.
        </p>
        <div className="settings-areas">
          {state.areas.map((a) => (
            <div key={a.id}>
              <i style={{ background: a.color }} />
              <input
                aria-label={`Rename ${a.name}`}
                defaultValue={a.name}
                onBlur={(e) => {
                  if (e.target.value.trim())
                    void commit((s) => ({
                      ...s,
                      areas: s.areas.map((item) =>
                        item.id === a.id
                          ? { ...item, name: e.target.value.trim() }
                          : item,
                      ),
                    })).catch(() => {});
                  else e.target.value = a.name;
                }}
              />
              <span>
                {state.projects.filter((p) => p.areaId === a.id).length}{" "}
                projects
              </span>
              <button
                className="icon-button"
                title="Remove empty area"
                disabled={
                  state.projects.some((p) => p.areaId === a.id) ||
                  state.areas.length === 1
                }
                onClick={() =>
                  void commit((s) => ({
                    ...s,
                    areas: s.areas.filter((item) => item.id !== a.id),
                  })).catch(() => {})
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <form
          className="area-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await commit((s) => ({
              ...s,
              areas: [
                ...s.areas,
                {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  color,
                  icon: "layers",
                },
              ],
            })).catch(() => {});
            setName("");
          }}
        >
          <input
            type="color"
            aria-label="Research area color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <input
            aria-label="New research area"
            placeholder="New research area…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="button" disabled={!name.trim()}>
            <Plus size={14} /> Add area
          </button>
        </form>
        <p className="form-help">
          Move an area’s projects elsewhere before removing the area.
        </p>
      </section>
      <section className="detail-card">
        <div className="section-heading">
          <h2>
            <FolderOpen size={17} /> Your data, on your Mac
          </h2>
          <span className="sample-tag">LOCAL FIRST</span>
        </div>
        <p className="muted">
          Project metadata, notes, tasks, and dates are stored as JSON. Your
          manuscript stays in its project folder.
        </p>
        <div className="data-path">
          {info?.dataPath || "Loading storage location…"}
        </div>
        <div className="backup-actions">
          <button
            className="button"
            onClick={async () => {
              try {
                if (await window.research!.exportWorkspace())
                  notify(
                    "Workspace exported. Project files are stored separately.",
                  );
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            <ArrowDownToLine size={16} /> Export workspace
          </button>
          <button
            className="button"
            onClick={async () => {
              try {
                const result = await window.research!.importWorkspace();
                if (result) {
                  imported(result);
                  notify(
                    "Workspace imported. The previous workspace was backed up.",
                  );
                }
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            <ArrowUpFromLine size={16} /> Import workspace
          </button>
        </div>
        <p className="form-help">
          Exports contain metadata and local folder paths. Back up your project
          folders separately.
        </p>
      </section>
    </div>
  );
}
