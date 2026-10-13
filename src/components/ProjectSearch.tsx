import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Command as CommandIcon,
  FileText,
  Folder,
  Search,
  LoaderCircle,
  MessageSquare,
  StickyNote,
  BookOpen,
  SlidersHorizontal,
} from "lucide-react";
import { matchCommands } from "../commands";
import type { Project, SearchHit, SearchPacket } from "../types";
import { matchesProject, StageBadge } from "./ui";

const filters = [
  ["all", "All"],
  ["project", "Projects & notes"],
  ["file", "Files"],
  ["pdf", "PDFs"],
  ["chat", "Chats"],
] as const;
type Kind = (typeof filters)[number][0];
const kindMatches = (hit: SearchHit, kind: Kind) =>
  kind === "all" ||
  hit.kind === kind ||
  (kind === "pdf" && hit.kind === "annotation");
const icons = {
  project: Folder,
  file: FileText,
  pdf: BookOpen,
  annotation: StickyNote,
  chat: MessageSquare,
};
const labels = {
  project: "Project & notes",
  file: "File",
  pdf: "PDF",
  annotation: "Annotation",
  chat: "Conversation",
};

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 10);
  if (!words.length) return <>{text}</>;
  const pattern = words
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return (
    <>
      {text
        .split(new RegExp(`(${pattern})`, "gi"))
        .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

// One query supports both quick matches and a full search. Enter only asks the
// agent from the conversation view; browsing search results never starts a run.
export function useProjectSearch({
  query,
  projects,
  enabled,
  expanded,
  currentProjectId,
  expand,
  collapse,
  open,
  openResult,
  close,
}: {
  query: string;
  projects: Project[];
  enabled: boolean;
  expanded: boolean;
  currentProjectId?: string;
  expand(): void;
  collapse(): void;
  open(id: string): void;
  openResult(hit: SearchHit): void;
  close(): void;
}) {
  const [active, setActive] = useState(-1);
  const [packet, setPacket] = useState<SearchPacket>({
    results: [],
    warnings: [],
    scanned: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [currentOnly, setCurrentOnly] = useState(false);
  const request = useRef("");
  const listId = useId();
  const term = enabled ? query.trim().slice(0, 200) : "";
  const commandMode = term.startsWith(">");
  const searching = !commandMode && term.length >= 2;
  const commands = commandMode ? matchCommands(term.slice(1)) : [];
  const inScope = (projectId: string) =>
    !expanded ||
    !currentOnly ||
    !currentProjectId ||
    projectId === currentProjectId;
  const scopedHits = packet.results.filter((hit) => inScope(hit.projectId));
  const results = scopedHits.filter((hit) =>
    kindMatches(hit, expanded ? kind : "all"),
  );
  const matches =
    !commandMode &&
    !searching &&
    (expanded || !!term) &&
    (!expanded || kind === "all" || kind === "project")
      ? projects.filter((p) => inScope(p.id) && matchesProject(p, term))
      : [];
  const total = commandMode
    ? commands.length
    : searching
      ? results.length
      : matches.length;
  const visibleResults = expanded ? results : results.slice(0, 4);
  const visibleProjects = expanded ? matches : matches.slice(0, 4);
  const visibleTotal = commandMode
    ? commands.length
    : searching
      ? visibleResults.length
      : visibleProjects.length;
  const activeId =
    active >= 0 && active < visibleTotal ? `${listId}-${active}` : undefined;
  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  useEffect(() => {
    setActive(expanded || commandMode ? 0 : -1);
  }, [expanded, kind, currentOnly, currentProjectId]);
  useEffect(() => {
    if (!enabled) return;
    const id = crypto.randomUUID();
    request.current = id;
    setActive(commandMode || expanded ? 0 : -1);
    setPacket({ results: [], warnings: [], scanned: 0 });
    setError("");
    setBusy(searching);
    void window.research!.cancelSearch();
    if (!searching) return;
    const timer = setTimeout(() => {
      void window.research!.search(term, id).then(
        (result) => {
          if (request.current === id) {
            // IPC progress events can arrive after the query promise settles.
            // Retire this request so a partial packet cannot replace its result.
            request.current = "";
            setPacket(result);
            setBusy(false);
          }
        },
        (e) => {
          if (request.current === id) {
            request.current = "";
            setError(e.message);
            setBusy(false);
          }
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      request.current = "";
    };
  }, [term, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const off = window.research!.onSearchProgress((value) => {
      if (value.id === request.current) setPacket(value);
    });
    return () => {
      request.current = "";
      off();
      void window.research!.cancelSearch();
    };
  }, [enabled]);
  function select(index: number) {
    if (commandMode) {
      if (commands[index]) {
        close();
        commands[index].run();
      }
    } else if (searching) {
      if (visibleResults[index]) openResult(visibleResults[index]);
    } else if (visibleProjects[index]) open(visibleProjects[index].id);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      !enabled ||
      (!term && !expanded) ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return false;
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (
      step &&
      visibleTotal &&
      (expanded || active >= 0 || !query.includes("\n"))
    ) {
      event.preventDefault();
      setActive(
        expanded
          ? (active + step + visibleTotal) % visibleTotal
          : ((active + step + visibleTotal + 2) % (visibleTotal + 1)) - 1,
      );
      return true;
    }
    if (event.key === "Escape" && (expanded || active >= 0)) {
      event.preventDefault();
      event.stopPropagation();
      if (expanded) collapse();
      setActive(-1);
      return true;
    }
    if (event.key === "Enter" && (expanded || active >= 0 || commandMode)) {
      event.preventDefault();
      select(activeId ? active : 0);
      return true;
    }
    return false;
  }
  const row = (index: number) => ({
    id: `${listId}-${index}`,
    role: "option",
    "aria-selected": index === active,
    type: "button" as const,
    onClick: () => select(index),
  });
  return {
    activeId,
    listId,
    handleKeyDown,
    hasQuery: !!term,
    content: enabled && (!!term || expanded) && (
      <section
        className={`workspace-live-search ${expanded ? "expanded" : ""}`}
        aria-label="Workspace search results"
      >
        <div className="workspace-results-heading">
          <div>
            <Search size={14} />
            <strong>
              {commandMode
                ? "Commands"
                : expanded
                  ? "Search workspace"
                  : "Search matches"}
            </strong>
            {busy ? (
              <LoaderCircle size={13} className="spin" aria-label="Searching" />
            ) : (
              <span className="workspace-result-count" role="status">
                {total}
              </span>
            )}
          </div>
          {!commandMode &&
            (expanded ? (
              <button
                type="button"
                className="workspace-search-return"
                onClick={collapse}
              >
                <ArrowLeft size={13} /> Back to conversation
              </button>
            ) : (
              <button
                type="button"
                className="workspace-search-expand"
                onClick={expand}
              >
                Browse results <ArrowUpRight size={13} />
              </button>
            ))}
        </div>
        {expanded && !commandMode && (
          <div className="workspace-search-filters">
            <div role="group" aria-label="Search result type">
              {filters.map(([value, label]) => {
                const count = searching
                  ? scopedHits.filter((hit) => kindMatches(hit, value)).length
                  : value === "all" || value === "project"
                    ? projects.filter(
                        (p) => inScope(p.id) && matchesProject(p, term),
                      ).length
                    : 0;
                return (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                  >
                    {label}
                    {searching && <span>{count}</span>}
                  </button>
                );
              })}
            </div>
            {currentProjectId && (
              <button
                type="button"
                className="workspace-search-scope"
                aria-pressed={currentOnly}
                title={projects.find((p) => p.id === currentProjectId)?.name}
                onClick={() => setCurrentOnly(!currentOnly)}
              >
                <SlidersHorizontal size={12} /> This project
              </button>
            )}
          </div>
        )}
        {expanded && !term && (
          <p className="workspace-search-intro">
            Search file contents, PDF text, notes, and conversations. Your
            projects are below.
          </p>
        )}
        {error && (
          <p role="alert" className="search-empty">
            {error}
          </p>
        )}
        <div
          className="search-results"
          role="listbox"
          aria-label="Workspace matches"
          id={listId}
          aria-busy={busy}
        >
          {commands.map((command, index) => (
            <button key={command.id} {...row(index)}>
              <CommandIcon size={16} />
              <div>
                <strong>{command.title}</strong>
                <span>{command.group}</span>
              </div>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
          {!commandMode &&
            (searching
              ? visibleResults.map((hit, index) => {
                  const Icon = icons[hit.kind];
                  return (
                    <button key={hit.id} {...row(index)}>
                      <span className={`workspace-hit-icon ${hit.kind}`}>
                        <Icon size={17} />
                      </span>
                      <div>
                        <strong>
                          <Highlight text={hit.title} query={term} />
                          {hit.page ? (
                            <small className="workspace-hit-position">
                              Page {hit.page}
                            </small>
                          ) : hit.line ? (
                            <small className="workspace-hit-position">
                              Line {hit.line}
                            </small>
                          ) : null}
                        </strong>
                        <span>
                          {hit.projectName} <i>·</i> {labels[hit.kind]}
                        </span>
                        {hit.snippet && (
                          <p className="search-snippet">
                            <Highlight text={hit.snippet} query={term} />
                          </p>
                        )}
                      </div>
                      <ArrowUpRight size={14} className="workspace-hit-open" />
                    </button>
                  );
                })
              : visibleProjects.map((p, index) => (
                  <button key={p.id} {...row(index)}>
                    <span className="workspace-hit-icon project">
                      <Folder size={17} />
                    </span>
                    <div>
                      <strong>
                        <Highlight text={p.name} query={term} />
                      </strong>
                      <span>
                        {p.id === currentProjectId
                          ? "Current project"
                          : "Project"}
                      </span>
                    </div>
                    <StageBadge stage={p.stage} />
                    <ArrowUpRight size={14} className="workspace-hit-open" />
                  </button>
                )))}
          {!total && !busy && !error && (
            <div className="workspace-search-empty">
              <Search size={22} />
              <strong>
                {commandMode
                  ? "No matching commands"
                  : !searching && expanded
                    ? "Start with a keyword"
                    : "No results found"}
              </strong>
              <p>
                {commandMode
                  ? "Try a different command name."
                  : !searching && expanded
                    ? "Type at least two characters to search your workspace."
                    : expanded && (kind !== "all" || currentOnly)
                      ? "Try another keyword or broaden your filters."
                      : "Try a filename, a phrase from a PDF, or a project name."}
              </p>
              {expanded && (kind !== "all" || currentOnly) && (
                <button
                  type="button"
                  onClick={() => {
                    setKind("all");
                    setCurrentOnly(false);
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
        {expanded && (
          <div className="workspace-search-footer">
            <span>
              {busy
                ? `Searching · ${packet.scanned} files checked`
                : searching
                  ? `${total} result${total === 1 ? "" : "s"}`
                  : `${total} project${total === 1 ? "" : "s"}`}
            </span>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate <kbd>↵</kbd> Open
            </span>
          </div>
        )}
        {!!packet.warnings.length && (
          <details className="search-warnings">
            <summary>{packet.warnings.length} search coverage notes</summary>
            {packet.warnings.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </details>
        )}
      </section>
    ),
  };
}
