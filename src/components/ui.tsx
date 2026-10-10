import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";
import type { Project, Stage } from "../types";
import { stageName } from "../types";

export const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export const matchesProject = (p: Project, query: string) =>
  `${p.name} ${p.summary} ${p.venue} ${p.topic ?? ""}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());

export function openExternal(url: string, report: (message: string) => void) {
  window.research!.openLink(url).catch((e: Error) => report(e.message));
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className="stage-badge" data-stage={stage}>
      <i />
      {stageName[stage]}
    </span>
  );
}

export function Options({ items }: { items: { id: string; name: string }[] }) {
  return items.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name}
    </option>
  ));
}

export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
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

export function Stat({
  icon,
  label,
  number,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  number: number;
  onClick?(): void;
}) {
  const Card = onClick ? "button" : "div";
  return (
    <Card className="stat-card" onClick={onClick}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{number}</span>
    </Card>
  );
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="search-field">
      <Search size={13} />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button title="Clear search" onClick={() => onChange("")}>
          <X size={12} />
        </button>
      )}
    </label>
  );
}

export function BlurField({
  value,
  onCommit,
  required,
  multiline,
  ...props
}: {
  value: string;
  onCommit(value: string): void;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    const next = draft.trim();
    if (required && !next) setDraft(value);
    else if (next !== value) onCommit(next);
  };
  // Leaving the view or closing the window saves like a blur does.
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    const flush = () => latest.current();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const field = {
    ...props,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: save,
  };
  return multiline ? <textarea {...field} /> : <input {...field} />;
}

export function Tabs<T extends string>({
  label,
  tabs,
  active,
  select,
  panel,
}: {
  label: string;
  tabs: { id: T; label: ReactNode }[];
  active: T;
  select(id: T): void;
  panel: string;
}) {
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        const index =
          (tabs.findIndex((t) => t.id === active) + step + tabs.length) %
          tabs.length;
        select(tabs[index].id);
        (e.currentTarget.children[index] as HTMLElement).focus();
      }}
    >
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          id={`${panel}-${id}`}
          role="tab"
          aria-selected={active === id}
          aria-controls={panel}
          tabIndex={active === id ? 0 : -1}
          onClick={() => select(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function TaskAdd({
  label,
  add,
}: {
  label: string;
  add(text: string): void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="task-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        add(text.trim());
        setText("");
      }}
    >
      <Plus size={15} />
      <input
        aria-label={label}
        placeholder="Add a concrete next step…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="button small" disabled={!text.trim()}>
        Add
      </button>
    </form>
  );
}
