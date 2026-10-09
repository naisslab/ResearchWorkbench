import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  Github,
  History,
  Link2,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type { GitDiff, GitStatus, ProjectFileRoot } from "./types";

const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
function changeLabel(status: string) {
  if (conflicts.has(status)) return "Conflict";
  if (status === "??") return "New";
  if (status.includes("R")) return "Renamed";
  if (status.includes("D")) return "Deleted";
  if (status.includes("A")) return "Added";
  return "Modified";
}
function githubLink(remote: string) {
  const match = remote.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
  );
  return match ? `https://github.com/${match[1]}` : "";
}
export default function GitPanel({
  projectId,
  roots,
  revision,
  save,
  changed,
}: {
  projectId: string;
  roots: ProjectFileRoot[];
  revision: number;
  save(): Promise<void>;
  changed(): Promise<void>;
}) {
  const [show, setShow] = useState(false);
  const [rootId, setRootId] = useState("primary");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [preview, setPreview] = useState<GitDiff | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const request = useRef(0);
  const dialog = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const available = roots.some((root) => root.id === rootId)
    ? rootId
    : roots[0]?.id;
  const refresh = useCallback(async () => {
    const token = ++request.current;
    if (!available) {
      setStatus(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const result = await window.research!.gitStatus(projectId, available);
      if (token === request.current) {
        setStatus(result);
        setError("");
      }
    } catch (error) {
      if (token === request.current) {
        setError((error as Error).message);
        setStatus(null);
      }
    } finally {
      if (token === request.current) setChecking(false);
    }
  }, [projectId, available]);
  useEffect(() => {
    setStatus(null);
    setExcluded([]);
    setActiveFile("");
    setNotice("");
    setCheckedAt("");
    setMessage("");
    setUrl("");
    return () => {
      request.current++;
    };
  }, [projectId, available]);
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);
  useEffect(() => {
    if (!show) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) setShow(false);
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ) || [],
        );
        const first = controls[0],
          last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [show, busy]);
  const changes = status?.changes || [];
  const selected = changes.filter((change) => !excluded.includes(change.file));
  const focused = changes.some((change) => change.file === activeFile)
    ? activeFile
    : changes[0]?.file;
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError("");
    if (show && available && focused) {
      window
        .research!.gitDiff(projectId, available, focused)
        .then((result) => {
          if (!cancelled) setPreview(result);
        })
        .catch((error: Error) => {
          if (!cancelled) setPreviewError(error.message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [show, available, projectId, focused, status]);
  async function operate(
    operation:
      "init" | "connect" | "commit" | "fetch" | "pull" | "push" | "sync",
  ) {
    if (!available || busy) return;
    setBusy(operation);
    setError("");
    setNotice("");
    try {
      await save();
      const result =
        operation === "init"
          ? await window.research!.gitInit(projectId, available)
          : operation === "connect"
            ? await window.research!.gitConnect(projectId, available, url)
            : operation === "commit"
              ? await window.research!.gitCommit(
                  projectId,
                  available,
                  message,
                  selected.map((change) => change.file),
                )
              : await window.research!.gitSync(projectId, available, operation);
      request.current++;
      setChecking(false);
      setStatus(result);
      if (operation === "commit") {
        setMessage("");
        setExcluded([]);
      }
      if (["fetch", "pull", "sync"].includes(operation))
        setCheckedAt(
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      setNotice(
        {
          init: "Local repository created.",
          connect: "Remote connected. Check remote to see its latest commits.",
          commit: "Commit saved locally. Push to publish it to your remote.",
          fetch: "Remote status updated.",
          pull: "Remote changes pulled.",
          push: "Commits pushed to the remote.",
          sync: "Repository synchronized.",
        }[operation],
      );
      if (["pull", "sync"].includes(operation)) await changed();
    } catch (error) {
      await refresh();
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  const hasConflict = changes.some((change) => conflicts.has(change.status));
  const locked = !!busy || checking;
  const blocked = changes.length > 0 || !!status?.detached || hasConflict;
  const divergent = !!status?.ahead && !!status?.behind;
  const remotePage = githubLink(status?.remote || "");
  const syncTitle = status?.detached
    ? "Detached HEAD"
    : hasConflict
      ? "Resolve conflicts"
      : changes.length
        ? "Review local changes"
        : divergent
          ? "Branches have diverged"
          : !status?.remote
            ? "Local repository"
            : status.behind
              ? "Remote changes available"
              : status.ahead
                ? "Ready to push"
                : "Up to date with fetched remote";
  return (
    <>
      <button
        ref={toggle}
        className="button small git-toggle"
        disabled={!roots.length}
        onClick={async () => {
          setShow(true);
          setError("");
          setNotice("");
          try {
            await save();
            await refresh();
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        <GitBranch size={14} />
        {status?.connected ? status.branch : "Git"}
        {!!changes.length && <small>{changes.length}</small>}
        {!!status?.ahead && (
          <span className="git-outgoing">
            <ArrowUp size={11} />
            {status.ahead}
          </span>
        )}
      </button>
      {show &&
        createPortal(
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) setShow(false);
            }}
          >
            <section
              ref={dialog}
              tabIndex={-1}
              className="modal git-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Git repository"
            >
              <header className="git-title">
                <div>
                  <h2>
                    <GitBranch size={19} /> Source control
                  </h2>
                  <p>Review your work, commit locally, then publish.</p>
                </div>
                <button
                  className="icon-button"
                  title="Close Git"
                  disabled={!!busy}
                  onClick={() => setShow(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="git-repo-bar">
                <label>
                  Local folder
                  <select
                    value={available || ""}
                    disabled={locked}
                    onChange={(event) => setRootId(event.target.value)}
                  >
                    {roots.map((root) => (
                      <option key={root.id} value={root.id}>
                        {root.label} · {root.folder.split("/").pop()}
                      </option>
                    ))}
                  </select>
                </label>
                {status?.connected && (
                  <div className="git-repository">
                    <strong>
                      <GitBranch size={14} />
                      {status.branch}
                    </strong>
                    <span title={status.repository}>
                      {status.repository?.split("/").pop()}
                    </span>
                  </div>
                )}
                <button
                  className="icon-button"
                  title="Refresh Git status"
                  disabled={locked}
                  onClick={refresh}
                >
                  <RefreshCw size={15} className={checking ? "spin" : ""} />
                </button>
              </div>
              <ol className="git-workflow" aria-label="Git workflow">
                {["Connect", "Review", "Commit", "Push"].map((step, index) => {
                  const done =
                    index === 0
                      ? !!status?.connected
                      : index === 1
                        ? !!status?.connected && !changes.length
                        : index === 2
                          ? !!status?.history?.length && !changes.length
                          : !!status?.remote &&
                            !status.ahead &&
                            !status.behind &&
                            !changes.length &&
                            !!status.hasRemoteBranch;
                  const current =
                    index === 0
                      ? !status?.connected
                      : index === 1
                        ? !!changes.length
                        : index === 2
                          ? !!status?.connected && !status.history?.length
                          : !!status?.connected &&
                            !changes.length &&
                            (!status.remote || !!status.ahead);
                  return (
                    <li
                      key={step}
                      className={done ? "done" : current ? "current" : ""}
                    >
                      {done ? <Check size={13} /> : <span>{index + 1}</span>}
                      {step}
                      {index < 3 && <ChevronRight size={12} />}
                    </li>
                  );
                })}
              </ol>
              {error && (
                <pre className="git-error" role="alert">
                  {error}
                </pre>
              )}
              {notice && (
                <div className="git-notice" role="status">
                  <CheckCheck size={14} />
                  {notice}
                </div>
              )}
              <div className="git-body">
                <div className="git-review">
                  <div className="git-changes-heading">
                    <strong>
                      {changes.length
                        ? `Changes · ${changes.length}`
                        : status?.connected
                          ? "Working tree clean"
                          : "Track your manuscript"}
                    </strong>
                    {!!changes.length && (
                      <label className="git-select-all">
                        <input
                          type="checkbox"
                          aria-label="Select all changes"
                          checked={selected.length === changes.length}
                          disabled={locked}
                          onChange={(event) =>
                            setExcluded(
                              event.target.checked
                                ? []
                                : changes.map((change) => change.file),
                            )
                          }
                        />
                        {selected.length} selected
                      </label>
                    )}
                  </div>
                  {changes.length ? (
                    <div className="git-review-grid">
                      <div className="git-changes">
                        {changes.map((change) => (
                          <div
                            key={change.file}
                            className={focused === change.file ? "active" : ""}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Include ${change.file} in commit`}
                              checked={!excluded.includes(change.file)}
                              disabled={locked || hasConflict}
                              onChange={(event) =>
                                setExcluded((current) =>
                                  event.target.checked
                                    ? current.filter(
                                        (file) => file !== change.file,
                                      )
                                    : [...current, change.file],
                                )
                              }
                            />
                            <button
                              onClick={() => setActiveFile(change.file)}
                              title={change.file}
                            >
                              <FileDiff size={14} />
                              <span>{change.file}</span>
                              <code
                                className={`git-file-${changeLabel(change.status).toLowerCase()}`}
                              >
                                {changeLabel(change.status)}
                              </code>
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="git-diff-pane">
                        <div className="git-diff-title">
                          <FileDiff size={14} />
                          <span title={focused}>{focused}</span>
                          <small>Compared to last commit</small>
                        </div>
                        <div
                          className="git-diff"
                          role="region"
                          aria-label="File diff"
                          tabIndex={0}
                        >
                          {preview ? (
                            <pre>
                              {preview.text.split("\n").map((line, index) => (
                                <div
                                  key={index}
                                  className={
                                    line.startsWith("+") &&
                                    !line.startsWith("+++")
                                      ? "addition"
                                      : line.startsWith("-") &&
                                          !line.startsWith("---")
                                        ? "deletion"
                                        : line.startsWith("@@")
                                          ? "hunk"
                                          : ""
                                  }
                                >
                                  <span className="git-diff-line">
                                    {index + 1}
                                  </span>
                                  <code>{line || " "}</code>
                                </div>
                              ))}
                            </pre>
                          ) : (
                            <p>{previewError || "Loading difference…"}</p>
                          )}
                          {preview?.truncated && (
                            <p className="git-caption">
                              Preview limited to 1,200 lines.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="git-empty">
                      {status?.connected ? (
                        <CheckCheck size={28} />
                      ) : (
                        <GitBranch size={28} />
                      )}
                      <strong>
                        {status?.connected
                          ? "Your files match the last commit"
                          : "A version history for your research"}
                      </strong>
                      <p>
                        {status?.connected
                          ? "Your next edits will appear here. Review each file before creating a commit."
                          : "Initialize this local folder, or connect an existing remote to begin tracking your work."}
                      </p>
                      {status && !status.connected && (
                        <button
                          className="button"
                          disabled={locked}
                          onClick={() => void operate("init")}
                        >
                          <GitBranch size={14} />
                          Initialize repository
                        </button>
                      )}
                    </div>
                  )}
                  {!!status?.history?.length && (
                    <section className="git-history">
                      <h3>
                        <History size={14} /> Recent commits{" "}
                        <span>Local branch</span>
                      </h3>
                      {status.history.slice(0, 4).map((commit) => (
                        <div key={commit.hash}>
                          <GitCommitHorizontal size={14} />
                          <span>
                            <strong title={commit.subject}>
                              {commit.subject}
                            </strong>
                            <small>
                              {commit.author} ·{" "}
                              {new Date(commit.date).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )}
                            </small>
                          </span>
                          <code>{commit.hash}</code>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
                <aside className="git-actions">
                  <section className="git-action-section">
                    <h3>
                      <GitCommitHorizontal size={15} /> Commit
                    </h3>
                    <p className="git-caption">
                      Save a checkpoint of the selected files.
                    </p>
                    <form
                      className="git-commit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void operate("commit");
                      }}
                    >
                      <label>
                        Commit message
                        <textarea
                          rows={3}
                          maxLength={1000}
                          value={message}
                          disabled={locked || !status?.connected}
                          onChange={(event) => setMessage(event.target.value)}
                          placeholder="Describe what changed"
                        />
                      </label>
                      <button
                        className="button primary"
                        disabled={
                          locked ||
                          !selected.length ||
                          !message.trim() ||
                          hasConflict ||
                          !!status?.detached
                        }
                      >
                        <GitCommitHorizontal size={14} />
                        Commit changes
                      </button>
                      <span className="git-caption">
                        {selected.length
                          ? `${selected.length} file${selected.length === 1 ? "" : "s"} included · saves locally`
                          : "Select changed files to commit"}
                      </span>
                    </form>
                  </section>
                  <section className="git-action-section">
                    <h3>
                      {remotePage ? <Github size={15} /> : <Link2 size={15} />}{" "}
                      Remote
                      {remotePage && (
                        <button
                          className="icon-button"
                          title="Open repository on GitHub"
                          onClick={() =>
                            void window.research!.openLink(remotePage)
                          }
                        >
                          <ExternalLink size={13} />
                        </button>
                      )}
                    </h3>
                    {status?.remote ? (
                      <>
                        <div className="git-remote-detail">
                          <strong title={status.remote}>
                            {remotePage
                              ? remotePage.replace("https://github.com/", "")
                              : status.remoteName}
                          </strong>
                          <span title={status.remote}>{status.remote}</span>
                          <small>
                            {status.remoteName}/{status.remoteBranch}
                          </small>
                        </div>
                        <div className="git-sync-summary">
                          <strong>{syncTitle}</strong>
                          <div>
                            <span>
                              <ArrowUp size={13} />
                              {status.ahead} outgoing
                            </span>
                            <span>
                              <ArrowDown size={13} />
                              {status.behind} incoming
                            </span>
                          </div>
                        </div>
                        <button
                          className="button small git-fetch"
                          disabled={locked}
                          onClick={() => void operate("fetch")}
                        >
                          <RefreshCw size={13} />
                          Check remote
                        </button>
                        <p className="git-caption">
                          {checkedAt
                            ? `Last checked at ${checkedAt}`
                            : "Counts reflect the last fetch. Check remote for updates."}
                        </p>
                        <div className="git-sync">
                          <div>
                            <button
                              className="button small"
                              disabled={locked || blocked || divergent}
                              onClick={() => void operate("pull")}
                            >
                              <ArrowDown size={14} />
                              Pull
                            </button>
                            <button
                              className="button small"
                              disabled={
                                locked ||
                                blocked ||
                                !!status.behind ||
                                !status.history?.length
                              }
                              onClick={() => void operate("push")}
                            >
                              <ArrowUp size={14} />
                              Push
                            </button>
                            <button
                              className="button primary small"
                              disabled={
                                locked ||
                                blocked ||
                                divergent ||
                                !status.history?.length
                              }
                              onClick={() => void operate("sync")}
                            >
                              <RefreshCw size={14} />
                              Sync
                            </button>
                          </div>
                        </div>
                        <p className="git-caption">
                          {hasConflict
                            ? "Resolve conflicted files in the terminal first."
                            : status.detached
                              ? "Check out a branch in the terminal before publishing."
                              : changes.length
                                ? "Commit or stash your local changes before syncing."
                                : divergent
                                  ? "Both branches have new commits. Reconcile them in the terminal before syncing."
                                  : "Sync pulls remote changes, then pushes your local commits."}
                        </p>
                      </>
                    ) : (
                      status && (
                        <form
                          className="git-connect"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void operate("connect");
                          }}
                        >
                          <p>
                            {status.connected
                              ? "Version history is local. Connect a remote to publish and collaborate."
                              : "Connect this folder to a GitHub or Git remote."}
                          </p>
                          <label>
                            Git remote URL
                            <input
                              required
                              value={url}
                              disabled={locked}
                              onChange={(event) => setUrl(event.target.value)}
                              placeholder="git@github.com:you/paper.git"
                            />
                          </label>
                          <button
                            className="button"
                            disabled={locked || !url.trim()}
                          >
                            <Link2 size={14} />
                            Connect remote
                          </button>
                          <p className="git-caption">
                            Use an existing repository URL. Authentication uses
                            your configured Git credentials or SSH key.
                          </p>
                        </form>
                      )
                    )}
                  </section>
                </aside>
              </div>
              <footer className="git-footer">
                {busy || checking ? (
                  <span className="git-progress">
                    <LoaderCircle size={13} className="spin" />
                    {busy ? `Git ${busy}…` : "Checking repository…"}
                  </span>
                ) : (
                  <span>
                    <Circle size={7} fill="currentColor" />{" "}
                    {status?.connected
                      ? "Local Git repository"
                      : "Local folder"}
                  </span>
                )}
                <span>Save → Commit → Push</span>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
