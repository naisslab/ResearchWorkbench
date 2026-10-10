import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import type { AISkill, AISkillCatalog } from "./types";

const scopeLabel = {
  user: "Local",
  repo: "Project",
  system: "Built-in",
  admin: "Managed",
};

export default function AISkills({
  catalog,
  loading,
  error,
  selected,
  toggle,
  refresh,
  close,
  anchor,
}: {
  catalog: AISkillCatalog | null;
  loading: boolean;
  error: string;
  selected: AISkill[];
  toggle(skill: AISkill): void;
  refresh(): void;
  close(): void;
  anchor: HTMLButtonElement | null;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{
    left: number;
    bottom?: number;
    top?: number;
    maxHeight: number;
  }>({ left: 12, bottom: 12, maxHeight: 400 });
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const above = rect.top >= 240;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 382)),
        ...(above
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
        maxHeight: Math.min(
          440,
          above ? rect.top - 20 : window.innerHeight - rect.bottom - 20,
        ),
      });
    };
    place();
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    if (anchor?.closest(".ai-composer"))
      observer.observe(anchor.closest(".ai-composer")!);
    return () => {
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [anchor]);
  const skills = (catalog?.skills || [])
    .filter((skill) =>
      `${skill.name} ${skill.displayName} ${skill.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.name === "scale-writing") -
          Number(a.name === "scale-writing") || a.name.localeCompare(b.name),
    );
  return createPortal(
    <>
      <button
        className="ai-skills-dismiss"
        type="button"
        aria-label="Dismiss skills"
        onClick={close}
      />
      <div
        className="ai-skills-menu"
        style={position}
        role="dialog"
        aria-label="Choose skills"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="ai-skills-heading">
          <div>
            <strong>Skills</strong>
            <small>Instructions for this run</small>
          </div>
          <button
            type="button"
            aria-label="Refresh skills"
            title="Reload installed skills"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
          <button type="button" aria-label="Close skills" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <label className="ai-skills-search">
          <Search size={13} />
          <input
            autoFocus
            aria-label="Find a skill"
            placeholder="Find a skill…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="ai-skills-list">
          {loading && !catalog && (
            <p role="status">
              <LoaderCircle size={13} className="spin" /> Loading local skills…
            </p>
          )}
          {error && (
            <p role="alert" className="ai-skills-error">
              {error}
            </p>
          )}
          {!loading && !error && !skills.length && (
            <p>
              {query
                ? "No skills match your search."
                : "No skills found. Install a skill in ~/.agents/skills or this project’s .agents/skills, then refresh."}
            </p>
          )}
          {skills.map((skill) => {
            const active = selected.some((item) => item.id === skill.id);
            return (
              <button
                type="button"
                key={skill.id}
                className="ai-skill-option"
                aria-label={`Select ${skill.name}`}
                aria-pressed={active}
                disabled={!skill.enabled || (!active && selected.length >= 8)}
                onClick={() => toggle(skill)}
              >
                <span className={`ai-skill-check ${active ? "selected" : ""}`}>
                  {active && <Check size={12} />}
                </span>
                <span className="ai-skill-details">
                  <span className="ai-skill-name">
                    <strong>{skill.displayName}</strong>
                    <small>
                      {skill.enabled ? scopeLabel[skill.scope] : "Disabled"}
                    </small>
                  </span>
                  <span className="ai-skill-description">
                    {skill.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="ai-skills-footer">
          {selected.length
            ? `${selected.length} selected · sent with your next message`
            : "Select a skill, then describe what you need."}
          {!!catalog?.warnings && (
            <span>
              {catalog.warnings} {catalog.warnings === 1 ? "skill" : "skills"}{" "}
              could not be loaded.
            </span>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
