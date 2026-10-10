import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useSkillPopupPosition } from "./AISkills";
import type { AISkill } from "./types";

export default function AISkillSuggestions({
  id,
  anchor,
  skills,
  query,
  activeId,
  selected,
  loading,
  error,
  warnings,
  choose,
  highlight,
  refresh,
  close,
}: {
  id: string;
  anchor: HTMLTextAreaElement | null;
  skills: AISkill[];
  query: string;
  activeId?: string;
  selected: AISkill[];
  loading: boolean;
  error: string;
  warnings: number;
  choose(skill: AISkill): void;
  highlight(id: string): void;
  refresh(): void;
  close(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const position = useSkillPopupPosition(anchor, true);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !anchor?.contains(event.target as Node)
      )
        close();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [anchor, close]);
  useLayoutEffect(() => {
    if (activeId)
      document
        .getElementById(`${id}-${activeId}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [id, activeId]);
  return createPortal(
    <div
      ref={menu}
      className="ai-skills-menu ai-skill-suggestions"
      style={position}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="ai-skills-heading">
        <BookOpen size={15} />
        <div>
          <strong>Skills{query ? ` · /${query}` : ""}</strong>
          <small>Choose a skill for your next message</small>
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
          aria-label="Close skill suggestions"
          onClick={close}
        >
          <X size={14} />
        </button>
      </div>
      <div
        className="ai-skills-list"
        id={id}
        role="listbox"
        aria-label="Skill suggestions"
        aria-busy={loading}
      >
        {loading && !skills.length && (
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
          <p role="status">
            {selected.length >= 8
              ? "Up to eight skills can be selected. Remove a skill to add another."
              : query
                ? "No matching skills. Keep typing, or press Esc to use this as text."
                : "No enabled skills found. Install a skill, then refresh."}
          </p>
        )}
        {skills.map((skill) => (
          <button
            type="button"
            role="option"
            id={`${id}-${skill.id}`}
            key={skill.id}
            tabIndex={-1}
            aria-label={`Select ${skill.name}`}
            aria-selected={skill.id === activeId}
            className="ai-skill-option"
            onPointerMove={() => highlight(skill.id)}
            onClick={() => choose(skill)}
          >
            <span className="ai-skill-command-icon">
              <BookOpen size={14} />
            </span>
            <span className="ai-skill-details">
              <span className="ai-skill-name">
                <strong>/{skill.name}</strong>
                {selected.some((item) => item.id === skill.id) && (
                  <Check size={13} aria-label="Selected" />
                )}
              </span>
              <span className="ai-skill-description">{skill.description}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="ai-skills-footer">
        <span>↑ ↓ to navigate · Enter / Tab to select · Esc to close</span>
        {!!warnings && (
          <span>
            {warnings} {warnings === 1 ? "skill" : "skills"} could not be
            loaded.
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
