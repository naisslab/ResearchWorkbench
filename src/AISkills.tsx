import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Check,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { AISkill, AISkillCatalog } from "./types";

const scopeLabel = {
  user: "Local",
  repo: "Project",
  system: "Built-in",
  admin: "Managed",
};

function useSkillPopupPosition(anchor: HTMLElement | null, fitAnchor = false) {
  const [position, setPosition] = useState<{
    left: number;
    bottom?: number;
    top?: number;
    maxHeight: number;
    width: number;
  }>({ left: 12, bottom: 12, maxHeight: 400, width: 370 });
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const above = rect.top >= 240;
      const width = Math.min(
        370,
        window.innerWidth - 24,
        fitAnchor ? rect.width : 370,
      );
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
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
    window.addEventListener("scroll", place, true);
    const observer = new ResizeObserver(place);
    if (anchor) observer.observe(anchor);
    if (anchor?.closest(".ai-composer"))
      observer.observe(anchor.closest(".ai-composer")!);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer.disconnect();
    };
  }, [anchor, fitAnchor]);
  return position;
}

export default function AISkills({
  catalog,
  loading,
  error,
  selected,
  select,
  refresh,
  close,
  anchor,
  suggestions,
}: {
  catalog: AISkillCatalog | null;
  loading: boolean;
  error: string;
  selected: AISkill[];
  select(skill: AISkill): void;
  refresh(): void;
  close(): void;
  anchor: HTMLElement | null;
  suggestions?: {
    id: string;
    skills: AISkill[];
    query: string;
    activeId?: string;
    highlight(id: string): void;
  };
}) {
  const [search, setSearch] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const inline = !!suggestions;
  const query = suggestions?.query ?? search;
  const position = useSkillPopupPosition(anchor, inline);
  useEffect(() => {
    if (!inline) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !anchor?.contains(event.target as Node)
      )
        close();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [anchor, close, inline]);
  useLayoutEffect(() => {
    if (suggestions?.activeId)
      document
        .getElementById(`${suggestions.id}-${suggestions.activeId}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [suggestions?.id, suggestions?.activeId]);
  const skills =
    suggestions?.skills ??
    (catalog?.skills || [])
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
      {!inline && (
        <button
          className="ai-skills-dismiss"
          type="button"
          aria-label="Dismiss skills"
          onClick={close}
        />
      )}
      <div
        ref={menu}
        className={`ai-skills-menu ${inline ? "ai-skill-suggestions" : ""}`}
        style={position}
        role={inline ? undefined : "dialog"}
        aria-label={inline ? undefined : "Choose skills"}
        onMouseDown={inline ? (event) => event.preventDefault() : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="ai-skills-heading">
          {inline && <BookOpen size={15} />}
          <div>
            <strong>Skills{inline && query ? ` · /${query}` : ""}</strong>
            <small>
              {inline
                ? "Choose a skill for your next message"
                : "Instructions for this run"}
            </small>
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
          <button
            type="button"
            aria-label={inline ? "Close skill suggestions" : "Close skills"}
            onClick={close}
          >
            <X size={14} />
          </button>
        </div>
        {!inline && (
          <label className="ai-skills-search">
            <Search size={13} />
            <input
              autoFocus
              aria-label="Find a skill"
              placeholder="Find a skill…"
              value={query}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        )}
        <div
          className="ai-skills-list"
          id={suggestions?.id}
          role={inline ? "listbox" : undefined}
          aria-label={inline ? "Skill suggestions" : undefined}
          aria-busy={inline ? loading : undefined}
        >
          {loading && (inline ? !skills.length : !catalog) && (
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
            <p role={inline ? "status" : undefined}>
              {inline
                ? selected.length >= 8
                  ? "Up to eight skills can be selected. Remove a skill to add another."
                  : query
                    ? "No matching skills. Keep typing, or press Esc to use this as text."
                    : "No enabled skills found. Install a skill, then refresh."
                : query
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
                role={inline ? "option" : undefined}
                id={suggestions ? `${suggestions.id}-${skill.id}` : undefined}
                tabIndex={inline ? -1 : undefined}
                className="ai-skill-option"
                aria-label={`Select ${skill.name}`}
                aria-selected={
                  inline ? skill.id === suggestions.activeId : undefined
                }
                aria-pressed={inline ? undefined : active}
                disabled={
                  !inline &&
                  (!skill.enabled || (!active && selected.length >= 8))
                }
                onPointerMove={
                  suggestions
                    ? () => suggestions.highlight(skill.id)
                    : undefined
                }
                onClick={() => select(skill)}
              >
                <span
                  className={
                    inline
                      ? "ai-skill-command-icon"
                      : `ai-skill-check ${active ? "selected" : ""}`
                  }
                >
                  {inline ? (
                    <BookOpen size={14} />
                  ) : (
                    active && <Check size={12} />
                  )}
                </span>
                <span className="ai-skill-details">
                  <span className="ai-skill-name">
                    <strong>
                      {inline ? `/${skill.name}` : skill.displayName}
                    </strong>
                    {inline ? (
                      active && <Check size={13} aria-label="Selected" />
                    ) : (
                      <small>
                        {skill.enabled ? scopeLabel[skill.scope] : "Disabled"}
                      </small>
                    )}
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
          {inline ? (
            <span>↑ ↓ to navigate · Enter / Tab to select · Esc to close</span>
          ) : selected.length ? (
            `${selected.length} selected · sent with your next message`
          ) : (
            "Select a skill, then describe what you need."
          )}
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
