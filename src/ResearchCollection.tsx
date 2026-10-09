import { useEffect, useState } from "react";
import { ArrowRight, Check, ExternalLink, FolderOpen, Library, Search } from "lucide-react";
import type { ResearchCatalog, Workspace } from "./types";
import { stages } from "./types";
import { AreaIcon, ProjectIcon } from "./ResearchIcons";

export default function ResearchCollection({ state, added, report }: {
  state: Workspace; added(state: Workspace, count: number): void; report(message: string): void;
}) {
  const [catalog, setCatalog] = useState<ResearchCatalog>();
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState("current");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const exists = (id: string, name: string) => state.projects.some((p) =>
    p.catalogId === id || p.id === `research-${id}` || p.name.trim().toLowerCase() === name.trim().toLowerCase());
  async function load() {
    setLoadError("");
    try {
      const data = await window.research!.researchCatalog();
      setCatalog(data);
      setSelected(data.candidates.filter((c) => c.recommended && !exists(c.id, c.project.name)).map((c) => c.id));
    } catch (error) { setLoadError((error as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  if (!catalog) return <div className="collection-loading"><Library size={28} /><p>{loadError || "Opening your research collection…"}</p>{loadError && <button className="button" onClick={() => void load()}>Retry</button>}</div>;
  const tabs = [
    { id: "current", name: "Current research", count: catalog.candidates.filter((c) => c.collection === "current" && c.confidence !== "review").length },
    { id: "review", name: "Needs review", count: catalog.candidates.filter((c) => c.confidence === "review").length },
    { id: "archive", name: "Research archive", count: catalog.candidates.filter((c) => c.collection === "archive").length },
  ];
  const visible = catalog.candidates.filter((c) =>
    (tab === "review" ? c.confidence === "review" : tab === "archive" ? c.collection === "archive" : c.collection === "current" && c.confidence !== "review") &&
    `${c.project.name} ${c.project.topic} ${c.project.summary}`.toLowerCase().includes(query.toLowerCase()));
  const availableSelected = selected.filter((id) => {
    const c = catalog.candidates.find((item) => item.id === id);
    return c && !exists(id, c.project.name);
  });
  return <div className="research-collection">
    <div className="collection-intro">
      <div className="collection-intro-mark"><Library size={24} strokeWidth={1.5} /></div>
      <div><strong>Your research, brought together.</strong><p>Personal website, NAISS Lab, local manuscripts and Overleaf. One project per research question, with code and draft versions kept together.</p></div>
      <span>REVIEWED {catalog.checkedAt}</span>
    </div>
    <div className="collection-toolbar">
      <div className="collection-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.name}<span>{item.count}</span></button>)}</div>
      <label className="collection-search"><Search size={14} /><input aria-label="Search research collection" placeholder="Search topics or projects…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    </div>
    <div className="collection-selection">
      <div><strong>{availableSelected.length} selected</strong><span>across the collection</span><button className="button text small" onClick={() => setSelected(catalog.candidates.filter((c) => c.recommended && !exists(c.id, c.project.name)).map((c) => c.id))}>Select recommended</button><button className="button text small" onClick={() => setSelected([])}>Clear</button></div>
      <button className="button primary" disabled={busy || !availableSelected.length} onClick={async () => {
        setBusy(true);
        try {
          const next = await window.research!.addResearchProjects(availableSelected);
          const count = next.projects.length - state.projects.length;
          setSelected([]);
          added(next, count);
        } catch (error) { report((error as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? "Adding…" : "Add selected projects"}<ArrowRight size={14} /></button>
    </div>
    <p className="collection-guidance">{tab === "review" ? "These Overleaf titles are verified. Research scope, topic and stage still need review; venue labels are draft context." : tab === "archive" ? "Earlier work and accepted papers for your research archive. Add only the projects you want to track." : "Publication stages follow website records. Stages inferred from local drafts remain marked for confirmation."}</p>
    {catalog.areas.map((area) => {
      const candidates = visible.filter((c) => c.project.areaId === area.id);
      if (!candidates.length) return null;
      return <section className="collection-area" key={area.id}>
        <div className="collection-area-heading" style={{ color: area.color }}><AreaIcon area={area} size={18} /><h2>{area.name}</h2><span>{candidates.length} projects</span></div>
        <div className="collection-grid">{candidates.map((c) => {
          const p = c.project;
          const imported = exists(c.id, p.name);
          return <article className={`collection-card ${selected.includes(c.id) && !imported ? "selected" : ""}`} key={c.id} style={{ "--area-color": area.color } as React.CSSProperties}>
            <div className="collection-card-heading">
              <span className="research-project-icon"><ProjectIcon project={p} /></span>
              <div><span className="collection-topic">{p.topic}</span><h3>{p.name}</h3></div>
              {imported ? <span className="collection-added"><Check size={13} />Added</span> : <input type="checkbox" aria-label={`Add ${p.name}`} checked={selected.includes(c.id)} disabled={busy} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))} />}
            </div>
            <p className="collection-summary">{p.summary}</p>
            <div className="collection-status"><span className={`stage-badge stage-${p.stage}`}><i style={{ background: stages.find((s) => s.id === p.stage)?.color }} />{stages.find((s) => s.id === p.stage)?.name}</span><span className={c.confidence === "verified" ? "verified" : "provisional"}>{c.confidence === "verified" ? "Website record" : "Confirm stage"}</span></div>
            <p className="collection-status-note">{c.statusNote}</p>
            <div className="collection-links">{p.folder && <span title={p.folder}><FolderOpen size={12} />Local {p.mainFile ? "manuscript" : "workspace"}</span>}{p.links?.slice(0, 4).map((link) => <button key={link.url} onClick={() => void window.research!.openLink(link.url).catch((e) => report(e.message))}>{link.label}<ExternalLink size={11} /></button>)}</div>
            <details className="collection-evidence"><summary>Sources & versions</summary><pre>{p.sourceNote}{p.notes ? "\n\n" + p.notes : ""}</pre></details>
          </article>;
        })}</div>
      </section>;
    })}
    {!visible.length && <p className="collection-guidance">No projects match this search.</p>}
  </div>;
}
