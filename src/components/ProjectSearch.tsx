import { useEffect, useId, useState } from "react";
import { ArrowRight, Folder, Search } from "lucide-react";
import type { Area, Project } from "../types";
import Modal from "../Modal";
import { matchesProject, StageBadge } from "./ui";

export default function ProjectSearch({
  projects,
  areas,
  open,
  close,
}: {
  projects: Project[];
  areas: Area[];
  open(id: string): void;
  close(): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useId();
  const results = projects.filter((p) => matchesProject(p, query));
  const option = (index: number) => `${list}-${index}`;
  useEffect(() => {
    document.getElementById(option(active))?.scrollIntoView({
      block: "nearest",
    });
  }, [active]);
  return (
    <Modal title="Find a project" onClose={close} className="search-modal">
      <div className="search-modal-input">
        <Search size={19} />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={list}
          aria-activedescendant={results.length ? option(active) : undefined}
          aria-label="Find a project"
          placeholder="Find a project…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            const step =
              e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
            if (step && results.length) {
              e.preventDefault();
              setActive((active + step + results.length) % results.length);
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              open(results[active].id);
            }
          }}
        />
      </div>
      <div className="search-results" role="listbox" id={list}>
        {results.map((p, index) => (
          <button
            key={p.id}
            id={option(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            onMouseMove={() => setActive(index)}
            onClick={() => open(p.id)}
          >
            <Folder size={17} />
            <div>
              <strong>{p.name}</strong>
              <span>{areas.find((a) => a.id === p.areaId)?.name}</span>
            </div>
            <StageBadge stage={p.stage} />
            <ArrowRight size={14} />
          </button>
        ))}
        {!results.length && (
          <p className="search-empty">No projects match “{query.trim()}”</p>
        )}
      </div>
    </Modal>
  );
}
