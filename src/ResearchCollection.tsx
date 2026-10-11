import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  FolderOpen,
  Library,
} from "lucide-react";
import type {
  Project,
  ResearchCandidate,
  ResearchCatalog,
  Workspace,
} from "./types";
import { AreaIcon, ProjectIcon } from "./ResearchIcons";
import { openExternal, SearchField, StageBadge, Tabs } from "./components/ui";
import { exclusive } from "./workspace-lock";
import { applyOrder, moveId, useReorder } from "./reorder";

type Tab = "current" | "review" | "archive";
const tabs: [Tab, string, (c: ResearchCandidate) => boolean][] = [
  [
    "current",
    "Current research",
    (c) => c.collection === "current" && c.confidence !== "review",
  ],
  ["review", "Needs review", (c) => c.confidence === "review"],
  ["archive", "Research archive", (c) => c.collection === "archive"],
];

export default function ResearchCollection({
  state,
  added,
  openProject,
  report,
  reorder,
}: {
  state: Workspace;
  added(state: Workspace, count: number): void;
  /** Saves the order cards were dragged into. */
  reorder(ids: string[]): void;
  openProject(id: string): void;
  report(message: string): void;
}) {
  const [catalog, setCatalog] = useState<ResearchCatalog>();
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("current");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const known = new Map<string | undefined, Project>(
    state.projects.flatMap((p) => [
      [p.catalogId, p],
      [p.id, p],
      [p.name.trim().toLowerCase(), p],
    ]),
  );
  const existing = (c: ResearchCandidate) =>
    known.get(c.id) ??
    known.get(`research-${c.id}`) ??
    known.get(c.project.name.trim().toLowerCase());
  const recommended = (data: ResearchCatalog) =>
    data.candidates
      .filter((c) => c.recommended && !existing(c))
      .map((c) => c.id);
  async function load() {
    setLoadError("");
    try {
      const data = await window.research!.researchCatalog();
      setCatalog(data);
      setSelected(recommended(data));
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  // Cards keep the order they were dragged into, within their area.
  const ordered = catalog
    ? applyOrder(catalog.candidates, (c) => c.id, state.collectionOrder)
    : [];
  const drag = useReorder(
    "application/x-research-candidate",
    ordered.map((c) => c.id),
    (moved, target) => {
      const area = (id: string) =>
        ordered.find((c) => c.id === id)?.project.areaId;
      if (area(moved) === area(target))
        reorder(
          moveId(
            ordered.map((c) => c.id),
            moved,
            target,
          ),
        );
    },
  );
  if (!catalog)
    return (
      <div className="collection-loading">
        <Library size={28} />
        <p>{loadError || "Opening your research collection…"}</p>
        {loadError && (
          <button className="button" onClick={() => void load()}>
            Retry
          </button>
        )}
      </div>
    );
  const inTab = tabs.find(([id]) => id === tab)![2];
  const visible = catalog.candidates.filter(
    (c) =>
      inTab(c) &&
      `${c.project.name} ${c.project.topic} ${c.project.summary}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const available = catalog.candidates
    .filter((c) => selected.includes(c.id) && !existing(c))
    .map((c) => c.id);
  return (
    <div className="research-collection">
      <div className="collection-intro">
        <div className="collection-intro-mark">
          <Library size={24} strokeWidth={1.5} />
        </div>
        <div>
          <strong>Your research, brought together.</strong>
          <p>
            Personal website, NAISS Lab, local manuscripts and Overleaf. One
            project per research question, with code and draft versions kept
            together.
          </p>
        </div>
        <span>REVIEWED {catalog.checkedAt}</span>
      </div>
      <div className="collection-toolbar">
        <Tabs<Tab>
          label="Research collection"
          panel="collection-panel"
          active={tab}
          select={setTab}
          tabs={tabs.map(([id, name, test]) => ({
            id,
            label: (
              <>
                {name}
                <span>{catalog.candidates.filter(test).length}</span>
              </>
            ),
          }))}
        />
        <SearchField
          label="Search research collection"
          placeholder="Search topics or projects…"
          value={query}
          onChange={setQuery}
        />
      </div>
      <div className="collection-selection">
        <div>
          <strong>{available.length} selected</strong>
          <span>across the collection</span>
          <button
            className="button text small"
            onClick={() => setSelected(recommended(catalog))}
          >
            Select recommended
          </button>
          <button className="button text small" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
        <button
          className="button primary"
          disabled={busy || !available.length}
          onClick={async () => {
            setBusy(true);
            try {
              await exclusive(async () => {
                const next =
                  await window.research!.addResearchProjects(available);
                setSelected([]);
                added(next, next.projects.length - state.projects.length);
              });
            } catch (error) {
              report((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add selected projects"}
          <ArrowRight size={14} />
        </button>
      </div>
      <div
        id="collection-panel"
        role="tabpanel"
        aria-labelledby={`collection-panel-${tab}`}
      >
        {catalog.areas.map((area) => {
          const candidates = ordered.filter(
            (c) => visible.includes(c) && c.project.areaId === area.id,
          );
          if (!candidates.length) return null;
          return (
            <section className="collection-area" key={area.id}>
              <div
                className="collection-area-heading"
                style={{ color: area.color }}
              >
                <AreaIcon area={area} size={18} />
                <h2>{area.name}</h2>
                <span>{candidates.length} projects</span>
              </div>
              <div className="collection-grid">
                {candidates.map((c) => {
                  const p = c.project;
                  const own = existing(c);
                  return (
                    <article
                      className={`collection-card ${selected.includes(c.id) && !own ? "selected" : ""}`}
                      key={c.id}
                      {...drag.row(
                        c.id,
                        candidates.map((item) => item.id),
                      )}
                      style={
                        { "--area-color": area.color } as React.CSSProperties
                      }
                    >
                      <div className="collection-card-heading">
                        <span className="research-project-icon">
                          <ProjectIcon project={p} />
                        </span>
                        <div>
                          <span className="collection-topic">{p.topic}</span>
                          <h3>{p.name}</h3>
                        </div>
                        {own ? (
                          <button
                            className="collection-added"
                            title={`Open ${own.name}`}
                            onClick={() => openProject(own.id)}
                          >
                            <Check size={13} />
                            Added
                          </button>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`Add ${p.name}`}
                            checked={selected.includes(c.id)}
                            disabled={busy}
                            onChange={(e) =>
                              setSelected((ids) =>
                                e.target.checked
                                  ? [...ids, c.id]
                                  : ids.filter((id) => id !== c.id),
                              )
                            }
                          />
                        )}
                      </div>
                      <p className="collection-summary">{p.summary}</p>
                      <div className="collection-status">
                        <StageBadge stage={(own ?? p).stage} />
                        <span>
                          {c.confidence === "verified"
                            ? "Website record"
                            : "Confirm stage"}
                        </span>
                      </div>
                      <p className="collection-status-note">{c.statusNote}</p>
                      <div className="collection-links">
                        {p.folder && (
                          <span title={p.folder}>
                            <FolderOpen size={12} />
                            Local {p.mainFile ? "manuscript" : "workspace"}
                          </span>
                        )}
                        {p.links?.slice(0, 4).map((link) => (
                          <button
                            key={link.url}
                            onClick={() => openExternal(link.url, report)}
                          >
                            {link.label}
                            <ExternalLink size={11} />
                          </button>
                        ))}
                      </div>
                      <details className="collection-evidence">
                        <summary>Sources & versions</summary>
                        <pre>
                          {p.sourceNote}
                          {p.notes ? "\n\n" + p.notes : ""}
                        </pre>
                      </details>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!visible.length && (
          <p className="collection-guidance">No projects match this search.</p>
        )}
      </div>
    </div>
  );
}
