import {
  applyProjectUpdate,
  applyWritingCapture,
  manuscriptChecks,
  type ProjectUpdate,
  type WritingCapture,
} from "./window-tools";
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
  Sparkles,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";
import type {
  AgentToolRequest,
  Commit,
  Navigate,
  Project,
  UpdateProject,
  View,
  Workspace,
} from "./types";
import { VIEWS } from "./types";
import { dueSoon, monthDay, upcomingItems, type DatedItem } from "./dates";
import PanelDivider from "./PanelDivider";
import { clamp, defaultPanelLayout } from "./panel-layout";
import {
  useSidebarLayout,
  useProjectPanelLayout,
  usePanelSize,
} from "./usePanelLayout";
import ResearchCollection from "./ResearchCollection";
import DeadlineHub, { DateEditor } from "./DeadlineHub";
import { MilestoneEditor } from "./ProjectMilestones";
import { DarkContext, useAppearance } from "./theme";
import { remoteChange } from "./workspace-lock";
import { ResearchMark } from "./ResearchIcons";
import { sortProjects } from "./project-order";
import { applyOrder, moveId } from "./reorder";
import Sidebar from "./components/Sidebar";
import WorkspaceAgentBar from "./components/WorkspaceAgentBar";
import {
  applyWorkspaceMutation,
  WORKSPACE_AGENT_ID,
  type WorkspaceMutation,
} from "./workspace-agent";
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
import { runCommand, useCommands } from "./commands";
import { WorkbenchVisibility } from "./WorkbenchVisibility";

const loadWorkbench = () => import("./Workbench");
const Workbench = lazy(loadWorkbench);
function ProjectWorkbench(
  props: Omit<
    React.ComponentProps<typeof Workbench>,
    "layout" | "changeLayout"
  >,
) {
  const { layout, change } = useProjectPanelLayout(props.project.id);
  return <Workbench {...props} layout={layout} changeLayout={change} />;
}
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
  const { layout, change: changeLayout } = useSidebarLayout();
  const [shellRef, shell] = usePanelSize();
  const [state, setState] = useState<Workspace | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [selected, setSelected] = useState("");
  const [openedProjects, setOpenedProjects] = useState<string[]>([]);
  useEffect(() => {
    if (view === "workbench" && selected)
      setOpenedProjects((ids) =>
        ids.includes(selected) ? ids : [...ids, selected],
      );
  }, [view, selected]);
  const [areaFilter, setAreaFilter] = useState("all");
  // "" opens the form on the default area.
  const [newProjectArea, setNewProjectArea] = useState<string | null>(null);
  // A dated item to edit in project details; no item adds a milestone.
  const [editing, setEditing] = useState<{
    projectId: string;
    item?: DatedItem;
  }>();
  const [removing, setRemoving] = useState<Project | null>(null);
  const [searchTarget, setSearchTarget] =
    useState<import("./types").SearchHit>();
  const [searchOpen, setSearchOpen] = useState(false);
  // ">" opens the palette with commands only.
  const [searchStart, setSearchStart] = useState("");
  useEffect(() => {
    if (!searchOpen) setSearchStart("");
  }, [searchOpen]);
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
  const workspaceNavigate = useRef<Navigate>(() => {});

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
      for (let wait = remoteChange(); wait; wait = remoteChange()) await wait;
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
      // The states around the change, even when it waited for another one.
      let previous: Workspace | undefined, after: Workspace | undefined;
      const done = commit((state) => {
        previous = state;
        return (after = transform(state));
      });
      if (!(await done) || !previous || !after) return false;
      const restore = previous;
      show({
        tone: "info",
        message: label,
        action: {
          label: "Undo",
          run: () => void commit(() => restore),
          until: after,
        },
      });
      return true;
    },
    [commit, show],
  );
  // The agent's workspace edits go through the same saves as the user's,
  // with an Undo, and it is told the outcome only once they are saved.
  const runWindowTool = useCallback(
    async ({ tool, projectId, input }: AgentToolRequest) => {
      if (tool === "manage_workspace" || tool === "open_workspace_view") {
        if (projectId !== WORKSPACE_AGENT_ID)
          throw new Error("Use the workspace agent for this action.");
        if (tool === "open_workspace_view") {
          const target = input as { view: View; projectId: string };
          if (
            target.projectId &&
            !stateRef.current?.projects.some((p) => p.id === target.projectId)
          )
            throw new Error("The project no longer exists.");
          workspaceNavigate.current(target.view, {
            projectId: target.projectId,
            then: () => setSearchOpen(false),
          });
          return { requested: true };
        }
        let result = {};
        const done = await commitWithUndo(
          "Agent updated the workspace",
          (state) => {
            const next = applyWorkspaceMutation(
              state,
              input as WorkspaceMutation,
            );
            result = next.result;
            return next.state;
          },
        );
        if (!done) throw new Error("The workspace change could not be saved.");
        return { saved: true, ...result };
      }
      if (tool === "check_submission") {
        const project = stateRef.current?.projects.find(
          (p) => p.id === projectId,
        );
        if (!project) throw new Error("The project no longer exists.");
        return manuscriptChecks(project);
      }
      let result = {};
      const saved =
        tool === "record_writing_items"
          ? await commitWithUndo(
              "Saved writing items in Project details",
              (s) => applyWritingCapture(s, projectId, input as WritingCapture),
            )
          : await commitWithUndo("Agent updated the project plan", (s) => {
              const next = applyProjectUpdate(
                s,
                projectId,
                input as ProjectUpdate,
              );
              result = next.result;
              return next.state;
            });
      if (!saved)
        throw new Error(
          "The change could not be saved. The project may have closed or a disk write failed.",
        );
      return { saved: true, ...result };
    },
    [commitWithUndo],
  );
  useEffect(
    () =>
      window.research?.onAgentTool((request) => {
        void runWindowTool(request).then(
          (result) =>
            window.research!.completeAgentTool(request.id, {
              ok: true,
              result,
            }),
          (error: Error) =>
            window.research!.completeAgentTool(request.id, {
              ok: false,
              error: error.message,
            }),
        );
      }),
    [runWindowTool],
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
    (next, { projectId = selected, area = areaFilter, then } = {}) => {
      if (next === view && projectId === selected && area === areaFilter)
        return then?.();
      const go = () => {
        try {
          localStorage.setItem(
            "research-workbench.navigation",
            JSON.stringify({ view: next, projectId, area }),
          );
        } catch {}
        setView(next);
        setSelected(projectId);
        setAreaFilter(area);
        setToast((t) => (t?.tone === "danger" ? null : t));
        setManuscriptStatus(null);
        then?.();
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
  workspaceNavigate.current = navigate;
  useEffect(() => {
    if (
      state &&
      selected &&
      (view === "details" || view === "workbench") &&
      !state.projects.some((project) => project.id === selected)
    )
      navigate("overview", { projectId: "" });
    if (
      state &&
      areaFilter !== "all" &&
      !state.areas.some((area) => area.id === areaFilter)
    )
      setAreaFilter("all");
  }, [state, selected, view, areaFilter, navigate]);
  const newProject = useCallback(() => setNewProjectArea(""), []);
  // Projects whose agent is working, or finished while the user was
  // elsewhere; the sidebar marks them until the project is opened.
  const [agentRuns, setAgentRuns] = useState<
    Record<string, "running" | "done" | "failed">
  >({});
  const looking = useRef({ view, selected, navigate, searchOpen });
  looking.current = { view, selected, navigate, searchOpen };
  useEffect(() => {
    if (!window.research) return;
    void window.research.aiState().then((result) => {
      if (result.ok)
        setAgentRuns((current) => ({
          ...current,
          ...Object.fromEntries(
            (result.value.runningProjects ?? []).map((id) => [
              id,
              "running" as const,
            ]),
          ),
        }));
    });
    return window.research.onAIActivity((event) => {
      const { view, selected, navigate, searchOpen } = looking.current;
      const workspace = event.projectId === WORKSPACE_AGENT_ID;
      const seen =
        (workspace
          ? searchOpen
          : view === "workbench" && selected === event.projectId) &&
        document.hasFocus();
      const failed = ["failed", "interrupted"].includes(event.status || "");
      const outcome =
        event.running || event.continues
          ? "running"
          : seen || event.status === "cancelled"
            ? undefined
            : failed
              ? "failed"
              : "done";
      setAgentRuns(({ [event.projectId]: _, ...rest }) =>
        outcome ? { ...rest, [event.projectId]: outcome } : rest,
      );
      if (outcome !== "done" && outcome !== "failed") return;
      const name = workspace
        ? "the workspace"
        : stateRef.current?.projects.find((p) => p.id === event.projectId)
            ?.name || "a project";
      show({
        tone: failed ? "danger" : "success",
        message: failed
          ? `The agent stopped with an error in ${name}`
          : `The agent finished in ${name}`,
        action: {
          label: "Open",
          run: () =>
            workspace
              ? setSearchOpen(true)
              : navigate("workbench", { projectId: event.projectId }),
        },
      });
    });
  }, [show]);
  useEffect(() => {
    if (
      view === "workbench" &&
      agentRuns[selected] &&
      agentRuns[selected] !== "running"
    )
      setAgentRuns(({ [selected]: _, ...rest }) => rest);
  }, [view, selected, agentRuns]);
  useEffect(() => {
    if (
      searchOpen &&
      agentRuns[WORKSPACE_AGENT_ID] &&
      agentRuns[WORKSPACE_AGENT_ID] !== "running"
    )
      setAgentRuns(({ [WORKSPACE_AGENT_ID]: _, ...rest }) => rest);
  }, [searchOpen, agentRuns]);

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
    window.research.load().then(
      (next) => {
        replace(next);
        try {
          const saved = JSON.parse(
            localStorage.getItem("research-workbench.navigation") || "null",
          );
          if (
            saved &&
            VIEWS.includes(saved.view) &&
            (!saved.projectId ||
              next.projects.some((p) => p.id === saved.projectId))
          ) {
            setView(saved.view);
            setSelected(saved.projectId || "");
            setAreaFilter(
              next.areas.some((a) => a.id === saved.area) ? saved.area : "all",
            );
          }
        } catch {}
      },
      (e: Error) => setLoadingError(e.message),
    );
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
  useEffect(
    () =>
      window.research?.onMenuCommand((id) => {
        if (id === "search" || id === "commands") {
          setSearchStart(id === "commands" ? ">" : "");
          setSearchOpen(true);
        } else runCommand(id);
      }),
    [],
  );
  useCommands(() => [
    ...(
      [
        ["overview", "Overview"],
        ["board", "Project board"],
        ["deadlines", "Dates & deadlines"],
        ["collection", "Research collection"],
        ["settings", "Workspace settings"],
      ] as const
    ).map(([target, title]) => ({
      id: `go-${target}`,
      group: "Go to",
      title,
      run: () => navigate(target),
    })),
    ...(selected
      ? [
          {
            id: "go-workbench",
            group: "Go to",
            title: "Workbench of the current project",
            run: () => navigate("workbench", { projectId: selected }),
          },
        ]
      : []),
    {
      id: "new-project",
      group: "Project",
      title: "New project",
      run: newProject,
    },
    {
      id: "toggle-sidebar",
      group: "View",
      title: "Toggle sidebar",
      shortcut: "⌘\\",
      run: () => changeLayout({ sidebarCollapsed: !rail }),
    },
    {
      id: "toggle-theme",
      group: "View",
      title: dark ? "Switch to light mode" : "Switch to dark mode",
      run: () =>
        void commit((s) => ({ ...s, appearance: dark ? "light" : "dark" })),
    },
  ]);
  const ordered = useMemo(
    () =>
      state
        ? sortProjects(state.projects, undefined, state.trackedDeadlines)
        : [],
    [state?.projects, state?.trackedDeadlines],
  );
  // The sidebar follows the order the user dragged projects into; projects
  // never dragged follow, in priority order.
  const sidebarOrder = (s: Workspace) =>
    applyOrder(
      sortProjects(s.projects, undefined, s.trackedDeadlines),
      (p) => p.id,
      s.projectOrder,
    );
  const sidebarProjects = useMemo(
    () => (state ? applyOrder(ordered, (p) => p.id, state.projectOrder) : []),
    [ordered, state?.projectOrder],
  );
  const placeProject = useCallback(
    (moved: string, areaId: string, order: (ids: string[]) => string[]) => {
      const project = stateRef.current?.projects.find((p) => p.id === moved);
      const area = stateRef.current?.areas.find((a) => a.id === areaId);
      if (!project || !area) return;
      const transform = (s: Workspace) => ({
        ...s,
        projectOrder: order(sidebarOrder(s).map((p) => p.id)),
        projects: s.projects.map((p) =>
          p.id === moved
            ? { ...p, areaId, updatedAt: new Date().toISOString() }
            : p,
        ),
      });
      // Changing a project's area is offered for undo; reordering is not.
      void (project.areaId === areaId
        ? commit(transform)
        : commitWithUndo(`Moved ${project.name} to ${area.name}`, transform));
    },
    [commit, commitWithUndo],
  );
  const moveProject = useCallback(
    (moved: string, target: string) => {
      const areaId = stateRef.current?.projects.find(
        (p) => p.id === target,
      )?.areaId;
      if (areaId)
        placeProject(moved, areaId, (ids) => moveId(ids, moved, target));
    },
    [placeProject],
  );
  const moveProjectToArea = useCallback(
    (moved: string, areaId: string) =>
      placeProject(moved, areaId, (ids) => {
        const last = sidebarOrder(stateRef.current!)
          .filter((p) => p.areaId === areaId && p.id !== moved)
          .at(-1);
        return last ? moveId(ids, moved, last.id, true) : ids;
      }),
    [placeProject],
  );
  const moveArea = useCallback(
    (moved: string, target: string) =>
      void commit((s) => {
        const ids = moveId(
          s.areas.map((a) => a.id),
          moved,
          target,
        );
        return {
          ...s,
          areas: ids.map((id) => s.areas.find((a) => a.id === id)!),
        };
      }),
    [commit],
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
          projects={sidebarProjects}
          view={view}
          selected={selected}
          area={areaFilter}
          rail={rail}
          dueThisWeek={dueSoon(items, 7, now).length}
          agentRuns={agentRuns}
          navigate={navigate}
          addProject={setNewProjectArea}
          moveProject={moveProject}
          moveProjectToArea={moveProjectToArea}
          moveArea={moveArea}
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
          <button
            className="global-search"
            aria-label="Open workspace agent"
            onClick={() => setSearchOpen(true)}
          >
            <Sparkles size={14} />
            <span>Search, ask, or manage…</span>
            {agentRuns[WORKSPACE_AGENT_ID] && (
              <span
                className="agent-bar-badge"
                aria-label={`Workspace agent ${agentRuns[WORKSPACE_AGENT_ID]}`}
              />
            )}
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
        <DarkContext.Provider value={dark}>
          {[
            ...new Set([
              ...openedProjects,
              ...(view === "workbench" && project ? [project.id] : []),
            ]),
          ].map((id) => {
            const cached = state.projects.find((p) => p.id === id);
            if (!cached) return null;
            const visible = view === "workbench" && selected === id;
            return (
              <WorkbenchVisibility.Provider key={id} value={visible}>
                <div
                  className="project-workbench"
                  hidden={!visible}
                  data-project-id={id}
                >
                  <Suspense
                    fallback={
                      <div className="pane-empty">Opening workbench…</div>
                    }
                  >
                    <ProjectWorkbench
                      project={cached}
                      searchTarget={visible ? searchTarget : undefined}
                      update={async (changes) => {
                        await updateProject(id, changes);
                      }}
                      report={report}
                      clearError={clearError}
                      onStatus={setManuscriptStatus}
                    />
                  </Suspense>
                </div>
              </WorkbenchVisibility.Provider>
            );
          })}
        </DarkContext.Provider>
        {!(view === "workbench" && project) && (
          <div className="page-scroll" key={`${view}:${selected}`}>
            <div
              className={`page-content ${view === "settings" ? "settings-page" : ""}`}
            >
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
                  reorder={(ids) =>
                    void commit((s) => ({ ...s, collectionOrder: ids }))
                  }
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
        <WorkspaceAgentBar
          key={searchStart}
          projects={ordered}
          currentProject={
            view === "workbench" || view === "details" ? project : undefined
          }
          initialQuery={searchStart}
          openResult={(hit) => {
            setSearchOpen(false);
            navigate(hit.kind === "project" ? "details" : "workbench", {
              projectId: hit.projectId,
              then: () => setSearchTarget({ ...hit, id: crypto.randomUUID() }),
            });
          }}
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
  // Errors stay until dismissed or resolved, so a message is never missed.
  useEffect(() => {
    if (tone === "danger") return;
    const timer = setTimeout(dismiss, 8000);
    return () => clearTimeout(timer);
  }, [tone, dismiss]);
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
