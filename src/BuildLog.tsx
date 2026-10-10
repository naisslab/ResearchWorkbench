import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { errorPattern, type Problem } from "./latex";

export default memo(function BuildLog({
  projectId,
  busy,
  state,
  log,
  problems,
  open,
  compileOnSave,
  setCompileOnSave,
}: {
  projectId: string;
  busy: boolean;
  state: "idle" | "ok" | "error";
  /** The finished build's log; output streams in while `busy`. */
  log: string;
  problems: Problem[];
  open(file: string, rootId: string, line: number): void;
  compileOnSave: boolean;
  setCompileOnSave(on: boolean): void;
}) {
  const [streamed, setStreamed] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  const firstError = useRef<HTMLElement>(null);
  useEffect(() => {
    let pending = "";
    let frame = 0;
    const off = window.research!.onCompileOutput((data) => {
      if (data.projectId !== projectId) return;
      pending += data.text;
      frame ||= requestAnimationFrame(() => {
        const text = pending;
        pending = "";
        frame = 0;
        setStreamed((previous) => (previous + text).slice(-150000));
      });
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [projectId]);
  useEffect(() => {
    if (busy) setStreamed("");
  }, [busy]);
  const text = busy ? streamed : log;
  const at = !busy && state === "error" ? text.search(errorPattern) : -1;
  const end = at < 0 ? -1 : text.indexOf("\n", at) + 1 || text.length;
  useLayoutEffect(() => {
    const element = pre.current!;
    if (firstError.current)
      element.scrollTop +=
        firstError.current.getBoundingClientRect().top -
        element.getBoundingClientRect().top;
    else element.scrollTop = element.scrollHeight;
  }, [text]);
  return (
    <div className="build-panel">
      <div className="build-summary" data-state={busy ? "busy" : state}>
        <i
          className={state === "ok" ? "live-dot" : `idle-dot ${state}`}
          aria-hidden
        />
        {busy
          ? "Compiling with latexmk…"
          : state === "ok"
            ? "Build succeeded · PDF updated"
            : state === "error"
              ? "Build failed"
              : "Ready to compile"}
        <span>latexmk · pdfLaTeX · shell escape disabled</span>
        <label title="Compile after ⌘S saves a .tex or .bib file in the manuscript folder">
          <input
            type="checkbox"
            checked={compileOnSave}
            onChange={(event) => setCompileOnSave(event.target.checked)}
          />
          Compile on save
        </label>
      </div>
      {problems.length > 0 && (
        <ul className="build-problems">
          {problems.map((problem) => (
            <li key={`${problem.file}:${problem.line}:${problem.message}`}>
              <button
                disabled={problem.file.startsWith("/")}
                onClick={() => open(problem.file, "primary", problem.line)}
              >
                {problem.error ? (
                  <AlertCircle size={13} className="problem-error" />
                ) : (
                  <AlertTriangle size={13} className="problem-warning" />
                )}
                <span>{problem.message}</span>
                <small>
                  {problem.file}:{problem.line}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <pre ref={pre}>
        {at < 0 ? (
          text ||
          "Click Compile to build your LaTeX project. Compiler output will appear here."
        ) : (
          <>
            {text.slice(0, at)}
            <mark ref={firstError} className="log-error">
              {text.slice(at, end)}
            </mark>
            {text.slice(end)}
          </>
        )}
      </pre>
    </div>
  );
});
