import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";
import type {
  Commit,
  Navigate,
  Project,
  ProjectChanges,
  UpdateProject,
  View,
  Workspace,
} from "./types";
import { dueSoon, monthDay, upcomingItems, type DatedItem } from "./dates";
import PanelDivider from "./PanelDivider";
import { clamp, defaultPanelLayout } from "./panel-layout";
import { usePanelLayout, usePanelSize } from "./usePanelLayout";
import ResearchCollection from "./ResearchCollection";
import DeadlineHub, { DateEditor } from "./DeadlineHub";
import { MilestoneEditor } from "./ProjectMilestones";
import { DarkContext, useAppearance } from "./theme";
import { ResearchMark } from "./ResearchIcons";
import { sortProjects } from "./project-order";
import Sidebar from "./components/Sidebar";
import ProjectSearch from "./components/ProjectSearch";
import SaveStatus, {
  setManuscriptStatus,
  setSaveStatus,
} from "./components/SaveStatus";
import { NewProject, RemoveProject } from "./components/ProjectForms";
import OverviewView from "./views/OverviewView";
import BoardView from "./views/BoardView";
import ProjectDetailsView from "./views/ProjectDetailsView";
import SettingsView from "./views/SettingsView";
import { useTopDialog } from "./Modal";

const loadWorkbench = () => import("./Workbench");
const Workbench = lazy(loadWorkbench);
const RAIL = 52;
const MIN_SIDEBAR = 180;
// A drag that leaves the sidebar narrower than this snaps it to the rail.
const SNAP = 140;
const pages: Partial<Record<View, { title: string; newProject?: true }>> = {
  overview: { title: "Research Overview", newProject: true },
  board: { title: "Project Board", newProject: true },
  deadlines: { title: "Dates & Deadlines" },
  settings: { title: "Workspace Settings" },
  collection: { title: "Research Collection" },
};
type Toast = {
  id: number;
  tone: "danger" | "info" | "success";
  message: string;
  source?: string;
  /** `until` hides the action once the workspace has moved on from it. */
  action?: { label: string; run(): void; until?: Workspace };
};
let toastId = 0;

export default function App() {
  const { layout, change: changeLayout } = usePanelLayout();
  const [shellRef, shell] = usePanelSize();
  const [state, setState] = useState<Workspace | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [selected, setSelected] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  // "" opens the form on the default area.
  const [newProjectArea, setNewProjectArea] = useState<string | null>(null);
  // A dated item to edit in project details; no item adds a milestone.
  const [editing, setEditing] = useState<{
    projectId: string;
    item?: DatedItem;
  }>();
  const [removing, setRemoving] = useState<Project | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // One toast at a time; a newer one replaces it.
  const [toast, setToast] = useState<Toast | null>(null);
  const [info, setInfo] = useState<{ dataPath: string; version: string }>();
  const [now, setNow] = useState(Date.now);
  const dark = useAppearance(state?.appearance || "system");
  const toastHost = useTopDialog();
  const stateRef = useRef<Workspace | null>(null);
  const saved = useRef<{ state: Workspace | null; revision: number }>({
    state: null,
    revision: 0,
  });
  const revision = useRef(0);
  const pointer = useRef<{ start: number; held: number } | null>(null);

  const show = useCallback(
    (next: Omit<Toast, "id">) => setToast({ ...next, id: ++toastId }),
    [],
  );
  const report = useCallback(
    (message: string, source?: string, action?: Toast["action"]) =>
      show({ tone: "danger", message, source, action }),
    [show],
  );
  const notify = useCallback(
    (message: string) => show({ tone: "success", message }),
    [show],
  );
  const clearError = useCallback(
    (source: string) => setToast((t) => (t?.source === source ? null : t)),
    [],
  );
  const dismiss = useCallback(() => setToast(null), []);

  const replace = useCallback((next: Workspace) => {
    const normal = { ...next, trackedDeadlines: next.trackedDeadlines ?? [] };
    stateRef.current = normal;
    saved.current = { state: normal, revision: ++revision.current };
    setState(normal);
    setSaveStatus("Saved locally");
  }, []);
  const commit = useCallback<Commit>(
    async (transform) => {
      if (!stateRef.current) return false;
      const next = transform(stateRef.current);
      stateRef.current = next;
      setState(next);
      const mine = ++revision.current;
      setSaveStatus("Saving…");
      try {
        await window.research!.save(next);
        // Saves can settle out of order; only a newer one replaces the record.
        if (mine > saved.current.revision)
          saved.current = { state: next, revision: mine };
        if (mine === revision.current) {
          setSaveStatus("Saved locally");
          clearError("save");
        }
        return true;
      } catch (e) {
        const retry = () => void commit(transform);
        report((e as Error).message, "save", { label: "Retry", run: retry });
        // Main rejected this state; revert unless a later change is in flight.
        if (mine === revision.current) {
          stateRef.current = saved.current.state;
          setState(saved.current.state);
          setSaveStatus("Save failed", retry);
        }
        return false;
      }
    },
    [report, clearError],
  );
  const commitWithUndo = useCallback(
    async (label: string, transform: (state: Workspace) => Workspace) => {
      const previous = stateRef.current;
      const done = commit(transform);
      const after = stateRef.current;
      if (!(await done) || !previous || !after) return false;
      show({
        tone: "info",
        message: label,
        action: {
          label: "Undo",
          run: () => void commit(() => previous),
          until: after,
        },
      });
      return true;
    },
    [commit, show],
  );
  const updateProject = useCallback<UpdateProject>(
    (id, changes, undo) => {
      const patch = (s: Workspace) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === id
            ? {
                ...p,
                ...(typeof changes === "function" ? changes(p) : changes),
                updatedAt: new Date().toISOString(),
              }
            : p,
        ),
      });
      return undo ? commitWithUndo(undo, patch) : commit(patch);
    },
    [commit, commitWithUndo],
  );

  const navigate = useCallback<Navigate>(
    (next, { projectId = selected, area = areaFilter } = {}) => {
      if (next === view && projectId === selected && area === areaFilter)
        return;
      const go = () => {
        setView(next);
        setSelected(projectId);
        setAreaFilter(area);
        setToast((t) => (t?.tone === "danger" ? null : t));
        setManuscriptStatus(null);
      };
      // A listener that cancels the event takes over and calls `proceed` later.
      const event = new CustomEvent("research:navigate", {
        cancelable: true,
        detail: { proceed: go },
      });
      if (window.dispatchEvent(event)) go();
    },
    [view, selected, areaFilter],
  );
  const openProject = useCallback(
    (id: string) => navigate("details", { projectId: id }),
    [navigate],
  );
  const newProject = useCallback(() => setNewProjectArea(""), []);
  const updateSelected = useCallback(
    async (changes: ProjectChanges) => {
      await updateProject(selected, changes);
    },
    [selected, updateProject],
  );

  const rail = layout.sidebarCollapsed;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!window.research)
      return setLoadingError(
        "Open this workspace in the desktop app. Run npm run dev from the project folder.",
      );
    window.research
      .load()
      .then(replace, (e: Error) => setLoadingError(e.message));
    window.research.info().then(setInfo, () => {});
  }, [replace]);
  const ready = state !== null;
  useEffect(() => {
    if (!ready) return;
    const idle = requestIdleCallback(() => void loadWorkbench());
    return () => cancelIdleCallback(idle);
  }, [ready]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "k") setSearchOpen((open) => !open);
      else if (event.key === "\\") changeLayout({ sidebarCollapsed: !rail });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rail, changeLayout]);
  const ordered = useMemo(
    () =>
      state
        ? sortProjects(state.projects, undefined, state.trackedDeadlines)
        : [],
    [state?.projects, state?.trackedDeadlines],
  );
  const items = useMemo(
    () => (state ? upcomingItems(state, now) : []),
    [state?.projects, state?.trackedDeadlines, now],
  );

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

  const maxSidebar = Math.max(MIN_SIDEBAR, Math.min(420, shell.width - 750));
  const sidebarWidth = rail
    ? RAIL
    : clamp(layout.sidebar, MIN_SIDEBAR, maxSidebar);
  function resizeSidebar(width: number) {
    const drag = pointer.current;
    // A drag snaps at SNAP; a key press collapses one step below the minimum.
    if (width < (drag ? SNAP : rail ? RAIL + 1 : MIN_SIDEBAR)) {
      // Expanding later restores the width the drag started from.
      if (!rail)
        changeLayout({
          sidebarCollapsed: true,
          ...(drag && { sidebar: drag.start }),
        });
    } else if (rail) {
      // The rest of this drag can only widen the restored width.
      if (drag) drag.held = layout.sidebar;
      changeLayout({ sidebarCollapsed: false });
    } else
      changeLayout({ sidebar: Math.max(MIN_SIDEBAR, drag?.held ?? 0, width) });
  }
  const project = state.projects.find((p) => p.id === selected);
  const inProject = view === "details" || view === "workbench";
  const page = pages[view];
  const title =
    view === "overview"
      ? (state.areas.find((a) => a.id === areaFilter)?.name ?? page!.title)
      : inProject
        ? project?.name
        : page?.title;
  const editedDate = state.trackedDeadlines.find(
    (d) => d.id === editing?.item?.trackedId,
  );
  return (
    <div
      className="app-shell"
      ref={shellRef}
      onPointerDownCapture={() =>
        (pointer.current = { start: layout.sidebar, held: 0 })
      }
      onPointerUp={() => requestAnimationFrame(() => (pointer.current = null))}
    >
      <aside
        className={`sidebar ${rail ? "rail" : ""}`}
        style={{ width: sidebarWidth }}
      >
        <Sidebar
          areas={state.areas}
          projects={ordered}
          view={view}
          selected={selected}
          area={areaFilter}
          rail={rail}
          dueThisWeek={dueSoon(items, 7, now).length}
          navigate={navigate}
          addProject={setNewProjectArea}
        />
      </aside>
      <PanelDivider
        label="Resize research sidebar"
        value={sidebarWidth}
        min={RAIL}
        max={maxSidebar}
        change={resizeSidebar}
        reset={() =>
          changeLayout({
            sidebar: defaultPanelLayout.sidebar,
            sidebarCollapsed: false,
          })
        }
      />
      <main className="main">
        <header className="app-header">
          <nav className="header-location" aria-label="Location">
            {inProject && project ? (
              <>
                <button
                  className="crumb"
                  onClick={() => navigate("overview", { area: project.areaId })}
                >
                  {state.areas.find((a) => a.id === project.areaId)?.name}
                </button>
                <ChevronRight size={13} />
                <span className="crumb">{project.name}</span>
                <ChevronRight size={13} />
                <span className="crumb-switch">
                  {(["workbench", "details"] as const).map((v) => (
                    <button
                      key={v}
                      aria-current={view === v ? "page" : undefined}
                      onClick={() => navigate(v)}
                    >
                      {v === "workbench" ? "Workbench" : "Details"}
                    </button>
                  ))}
                </span>
              </>
            ) : (
              <span className="crumb">{title}</span>
            )}
          </nav>
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
              }))
            }
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <span className="header-date">{monthDay(now)}</span>
        </header>
        {view === "workbench" && project ? (
          <DarkContext.Provider value={dark}>
            <Suspense
              fallback={<div className="pane-empty">Opening workbench…</div>}
            >
              <Workbench
                key={project.id}
                project={project}
                update={updateSelected}
                report={report}
                clearError={clearError}
                onStatus={setManuscriptStatus}
                layout={layout}
                changeLayout={changeLayout}
              />
            </Suspense>
          </DarkContext.Provider>
        ) : (
          <div className="page-scroll" key={`${view}:${selected}`}>
            <div className="page-content">
              <div className="page-heading">
                <div>
                  <h1>{title}</h1>
                  {inProject && <p>{project?.summary}</p>}
                </div>
                <div className="page-heading-actions">
                  {view === "details" && project ? (
                    <button
                      className="button primary"
                      onClick={() => navigate("workbench")}
                    >
                      <TerminalSquare size={16} /> Open workbench{" "}
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    page?.newProject && (
                      <button className="button primary" onClick={newProject}>
                        <Plus size={16} /> New project
                      </button>
                    )
                  )}
                </div>
              </div>
              {view === "overview" && (
                <OverviewView
                  state={state}
                  projects={ordered}
                  items={items}
                  now={now}
                  area={areaFilter}
                  navigate={navigate}
                  newProject={newProject}
                  update={updateProject}
                />
              )}
              {view === "board" && (
                <BoardView
                  state={state}
                  projects={ordered}
                  area={areaFilter}
                  navigate={navigate}
                  update={updateProject}
                />
              )}
              {view === "deadlines" && (
                <DeadlineHub
                  state={state}
                  items={items}
                  now={now}
                  commit={commit}
                  commitWithUndo={commitWithUndo}
                  received={replace}
                  report={report}
                  notify={notify}
                  openProject={openProject}
                />
              )}
              {view === "details" && project && (
                <ProjectDetailsView
                  project={project}
                  dates={items.filter((d) => d.projectIds.includes(project.id))}
                  areas={state.areas}
                  update={(changes, undo) =>
                    void updateProject(project.id, changes, undo)
                  }
                  edit={(item) => setEditing({ projectId: project.id, item })}
                  remove={() => setRemoving(project)}
                  report={report}
                />
              )}
              {view === "collection" && (
                <ResearchCollection
                  state={state}
                  report={report}
                  openProject={openProject}
                  added={(next, count) => {
                    replace(next);
                    notify(
                      `${count} research projects added. Existing projects preserved.`,
                    );
                    navigate("board", { area: "all" });
                  }}
                />
              )}
              {view === "settings" && (
                <SettingsView
                  state={state}
                  info={info}
                  commit={commit}
                  report={report}
                  notify={notify}
                  imported={(next) => {
                    replace(next);
                    setSelected("");
                    setAreaFilter("all");
                  }}
                />
              )}
            </div>
          </div>
        )}
        <footer className="app-status">
          <SaveStatus workbench={view === "workbench"} />
        </footer>
      </main>
      {newProjectArea !== null && (
        <NewProject
          areas={state.areas}
          areaId={
            newProjectArea ||
            (areaFilter === "all" ? (state.areas[0]?.id ?? "") : areaFilter)
          }
          close={() => setNewProjectArea(null)}
          create={async (p) => {
            if (
              !(await commit((s) => ({ ...s, projects: [...s.projects, p] })))
            )
              return false;
            setNewProjectArea(null);
            navigate("details", { projectId: p.id });
            return true;
          }}
        />
      )}
      {editedDate ? (
        <DateEditor
          date={editedDate}
          state={state}
          commit={commit}
          close={() => setEditing(undefined)}
        />
      ) : (
        editing && (
          <MilestoneEditor
            projects={state.projects}
            projectId={editing.projectId}
            milestone={state.projects
              .find((p) => p.id === editing.projectId)
              ?.deadlines.find((d) => d.id === editing.item?.deadlineId)}
            commit={commit}
            close={() => setEditing(undefined)}
          />
        )
      )}
      {removing && (
        <RemoveProject
          project={removing}
          close={() => setRemoving(null)}
          remove={() => {
            setRemoving(null);
            navigate("overview");
            void commitWithUndo(`Removed “${removing.name}”`, (s) => ({
              ...s,
              projects: s.projects.filter((p) => p.id !== removing.id),
            }));
          }}
        />
      )}
      {searchOpen && (
        <ProjectSearch
          projects={ordered}
          areas={state.areas}
          open={(id) => {
            setSearchOpen(false);
            navigate("workbench", { projectId: id });
          }}
          close={() => setSearchOpen(false)}
        />
      )}
      {toast &&
        createPortal(
          <ToastItem
            key={toast.id}
            toast={toast}
            state={state}
            dismiss={dismiss}
          />,
          toastHost ?? document.body,
        )}
    </div>
  );
}

function ToastItem({
  toast: { tone, message, action },
  state,
  dismiss,
}: {
  toast: Toast;
  state: Workspace;
  dismiss(): void;
}) {
  useEffect(() => {
    const timer = setTimeout(dismiss, 8000);
    return () => clearTimeout(timer);
  }, [dismiss]);
  return (
    <div
      className="toast"
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      {tone === "danger" ? (
        <AlertCircle size={16} />
      ) : (
        <CheckCircle2 size={16} />
      )}
      <span>{message}</span>
      {action && (!action.until || action.until === state) && (
        <button
          className="button text small"
          onClick={() => {
            dismiss();
            action.run();
          }}
        >
          {action.label}
        </button>
      )}
      <button
        className="icon-button"
        aria-label="Dismiss notification"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
