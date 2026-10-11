import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { errorPattern, type Problem } from "./latex";
import type { SubmissionCheck } from "./submission.ts";

export default memo(function BuildLog({
  projectId,
  busy,
  state,
  log,
  problems,
  checks,
  open,
  compileOnSave,
  setCompileOnSave,
  onAskAgent,
}: {
  projectId: string;
  busy: boolean;
  state: "idle" | "ok" | "error";
  /** The finished build's log; output streams in while `busy`. */
  log: string;
  problems: Problem[];
  /** The submission check of the last compiled PDF. */
  checks: SubmissionCheck[] | null;
  open(file: string, rootId: string, line: number): void;
  /** Puts a request to fix the listed problems in the agent's composer. */
  onAskAgent?(): void;
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
        <span>latexmk · shell escape disabled</span>
        {onAskAgent &&
          !busy &&
          (problems.length > 0 ||
            checks?.some((check) => check.status !== "ok")) && (
            <button className="button text small" onClick={onAskAgent}>
              Ask Agent to fix
            </button>
          )}
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
            <ProblemRow
              key={`${problem.file}:${problem.line}:${problem.message}`}
              status={problem.error ? "fail" : "warn"}
              {...problem}
              open={open}
            />
          ))}
        </ul>
      )}
      {!busy && checks && checks.length > 0 && (
        <ul
          className="build-problems submission-checks"
          aria-label="Submission check"
        >
          {checks.map((check) => (
            <ProblemRow
              key={`${check.message}:${check.file}:${check.line}`}
              {...check}
              open={open}
            />
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

// A row opens its source line when the file is in the project.
function ProblemRow({
  status,
  message,
  file,
  line,
  open,
}: SubmissionCheck & {
  open(file: string, rootId: string, line: number): void;
}) {
  const content = (
    <>
      {status === "ok" ? (
        <CheckCircle2 size={13} className="problem-ok" />
      ) : status === "fail" ? (
        <AlertCircle size={13} className="problem-error" />
      ) : (
        <AlertTriangle size={13} className="problem-warning" />
      )}
      <span>{message}</span>
      {file && (
        <small>
          {file}:{line}
        </small>
      )}
    </>
  );
  return (
    <li>
      {file && !file.startsWith("/") ? (
        <button onClick={() => open(file, "primary", line || 1)}>
          {content}
        </button>
      ) : (
        <div>{content}</div>
      )}
    </li>
  );
}
