import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  Command as CommandIcon,
  Folder,
  Search,
  LoaderCircle,
} from "lucide-react";
import { matchCommands } from "../commands";
import type { Project, SearchHit, SearchPacket } from "../types";
import Modal from "../Modal";
import { matchesProject, StageBadge } from "./ui";

export default function ProjectSearch({
  projects,
  initialQuery = "",
  open,
  openResult,
  close,
}: {
  projects: Project[];
  initialQuery?: string;
  open(id: string): void;
  openResult(hit: SearchHit): void;
  close(): void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [packet, setPacket] = useState<SearchPacket>({
    results: [],
    warnings: [],
    scanned: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("all");
  const request = useRef("");
  const list = useId();
  // A leading ">" lists commands instead of searching, as in code editors.
  const commandMode = query.startsWith(">");
  const searching = !commandMode && query.trim().length >= 2;
  const commands = commandMode ? matchCommands(query.slice(1)) : [];
  const results = packet.results.filter(
    (hit) =>
      kind === "all" ||
      hit.kind === kind ||
      (kind === "pdf" && hit.kind === "annotation"),
  );
  const matches = projects.filter((p) => matchesProject(p, query));
  const total = commandMode
    ? commands.length
    : searching
      ? results.length
      : matches.length;
  const option = (index: number) => `${list}-${index}`;
  const row = (index: number) => ({
    id: option(index),
    role: "option",
    "aria-selected": index === active,
    onMouseMove: () => setActive(index),
    onClick: () => select(index),
  });
  useEffect(() => {
    document
      .getElementById(option(active))
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    const id = crypto.randomUUID();
    request.current = id;
    setActive(0);
    setPacket({ results: [], warnings: [], scanned: 0 });
    setError("");
    setBusy(searching);
    void window.research!.cancelSearch();
    if (!searching) return;
    const timer = setTimeout(() => {
      void window.research!.search(query.trim(), id).then(
        (result) => {
          if (request.current === id && !result.cancelled) {
            setPacket(result);
            setBusy(false);
          }
        },
        (e) => {
          if (request.current === id) {
            setError(e.message);
            setBusy(false);
          }
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const off = window.research!.onSearchProgress((value) => {
      if (value.id === request.current) setPacket(value);
    });
    return () => {
      request.current = "";
      off();
      void window.research!.cancelSearch();
    };
  }, []);
  function select(index: number) {
    if (commandMode) {
      close();
      commands[index]?.run();
    } else if (searching) {
      if (results[index]) openResult(results[index]);
    } else if (matches[index]) open(matches[index].id);
  }
  return (
    <Modal title="Search workspace" onClose={close} className="search-modal">
      <div className="search-modal-input">
        <Search size={19} />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={list}
          aria-activedescendant={
            total ? option(Math.min(active, total - 1)) : undefined
          }
          aria-label="Search workspace"
          placeholder="Projects, files, PDF text, notes, conversations… or > for commands"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const step =
              e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
            if (step && total) {
              e.preventDefault();
              setActive((active + step + total) % total);
            } else if (e.key === "Enter" && total) {
              e.preventDefault();
              select(Math.min(active, total - 1));
            }
          }}
        />
        {busy && <LoaderCircle className="spin" size={16} />}
      </div>
      <div className="search-filters">
        <select
          aria-label="Search result type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setActive(0);
          }}
        >
          <option value="all">All results</option>
          <option value="project">Projects & notes</option>
          <option value="file">Files & source</option>
          <option value="pdf">PDF text & annotations</option>
          <option value="chat">Conversations</option>
        </select>
        <span>
          {busy
            ? `Searching · ${packet.scanned} files`
            : commandMode
              ? `${commands.length} commands`
              : searching
                ? `${results.length} results`
                : "Type at least 2 characters for full-text search"}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="search-results" role="listbox" id={list}>
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
            ? results.map((hit, index) => (
                <button key={hit.id} {...row(index)}>
                  <Search size={16} />
                  <div>
                    <strong>
                      {hit.title}
                      {hit.page
                        ? ` · p. ${hit.page}`
                        : hit.line
                          ? `:${hit.line}`
                          : ""}
                    </strong>
                    <span>
                      {hit.projectName} · {hit.kind}
                    </span>
                    <p className="search-snippet">{hit.snippet}</p>
                  </div>
                  <ArrowRight size={14} />
                </button>
              ))
            : matches.map((p, index) => (
                <button key={p.id} {...row(index)}>
                  <Folder size={17} />
                  <div>
                    <strong>{p.name}</strong>
                  </div>
                  <StageBadge stage={p.stage} />
                  <ArrowRight size={14} />
                </button>
              )))}
        {searching && !results.length && !busy && (
          <p className="search-empty">No matching text found.</p>
        )}
        {commandMode && !commands.length && (
          <p className="search-empty">No matching commands.</p>
        )}
      </div>
      {!!packet.warnings.length && (
        <details className="search-warnings">
          <summary>{packet.warnings.length} search coverage notes</summary>
          {packet.warnings.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </details>
      )}
    </Modal>
  );
}
