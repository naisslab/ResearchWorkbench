import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  ExternalLink,
  FileDiff,
  FilePen,
  GitBranch,
  GitCommitHorizontal,
  Github,
  History,
  Link2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import Modal from "./Modal";
import { diffRows } from "./diff";
import { monthDay, timeLabel } from "./dates";
import { plural } from "./components/ui";
import type { GitDiff, GitStatus, ProjectFileRoot } from "./types";

const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
function changeLabel(status: string) {
  if (conflicts.has(status)) return "Conflict";
  if (status === "??") return "Untracked";
  if (status.includes("R")) return "Renamed";
  if (status.includes("D")) return "Deleted";
  if (status.includes("A")) return "Added";
  return "Modified";
}
const notices = {
  init: "Local repository created.",
  connect: "Remote connected. Check remote to see its latest commits.",
  commit: "Commit saved locally. Push to publish it to your remote.",
  fetch: "Remote status updated.",
  pull: "Remote changes pulled.",
  push: "Commits pushed to the remote.",
  sync: "Repository synchronized.",
};
type Operation = keyof typeof notices;
function githubLink(remote: string) {
  const match = remote.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
  );
  return match ? `https://github.com/${match[1]}` : "";
}
export default memo(function GitPanel({
  projectId,
  roots,
  revision,
  save,
  changed,
  onOpenFile,
  onOpenTerminal,
}: {
  projectId: string;
  roots: ProjectFileRoot[];
  revision: number;
  /** Writes unsaved edits and resolves to the saved file, if any. */
  save(): Promise<string | void>;
  changed(): Promise<void>;
  onOpenFile(file: string, rootId: string): void;
  onOpenTerminal(): void;
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
  const [excluded, setExcluded] = useState(new Set<string>());
  const [activeFile, setActiveFile] = useState("");
  const [preview, setPreview] = useState<GitDiff | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const request = useRef(0);
  const root = roots.find((root) => root.id === rootId) || roots[0];
  const available = root?.id;
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
    setExcluded(new Set());
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
  const changes = status?.changes || [];
  const selected = changes.filter((change) => !excluded.has(change.file));
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
  const rows = useMemo(() => preview && diffRows(preview.text), [preview]);
  async function operate(operation: Operation) {
    if (!available || busy) return;
    const git = window.research!;
    const calls: Record<Operation, () => Promise<GitStatus>> = {
      init: () => git.gitInit(projectId, available),
      connect: () => git.gitConnect(projectId, available, url),
      commit: () =>
        git.gitCommit(
          projectId,
          available,
          message,
          selected.map((change) => change.file),
        ),
      fetch: () => git.gitSync(projectId, available, "fetch"),
      pull: () => git.gitSync(projectId, available, "pull"),
      push: () => git.gitSync(projectId, available, "push"),
      sync: () => git.gitSync(projectId, available, "sync"),
    };
    setBusy(operation);
    setError("");
    setNotice("");
    try {
      await save();
      const result = await calls[operation]();
      request.current++;
      setChecking(false);
      setStatus(result);
      if (operation === "commit") {
        setMessage("");
        setExcluded(new Set());
      }
      if (["fetch", "pull", "sync"].includes(operation))
        setCheckedAt(timeLabel(Date.now()));
      setNotice(notices[operation]);
      if (["pull", "sync"].includes(operation)) await changed();
    } catch (error) {
      await refresh();
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  const connected = !!status?.connected;
  const clean = !changes.length;
  const hasHistory = !!status?.history?.length;
  const hasConflict = changes.some((change) => conflicts.has(change.status));
  const locked = !!busy || checking;
  const blocked = hasConflict || !!status?.detached;
  const divergent = !!status?.ahead && !!status?.behind;
  const remotePage = githubLink(status?.remote || "");
  const [syncTitle, syncHint] = hasConflict
    ? ["Resolve conflicts", "Resolve conflicted files in the terminal first."]
    : status?.detached
      ? [
          "Detached HEAD",
          "Check out a branch in the terminal before publishing.",
        ]
      : divergent
        ? [
            "Branches have diverged",
            "Both branches have new commits. Reconcile them in the terminal before syncing.",
          ]
        : [
            status?.behind
              ? "Remote changes available"
              : status?.ahead
                ? "Ready to push"
                : "Up to date with fetched remote",
            clean
              ? "Sync pulls remote changes, then pushes your local commits."
              : "Push publishes committed changes. Your edits stay local; Pull stops if remote changes would overwrite them.",
          ];
  // Git paths start at the repository root, which can sit above this folder.
  const repository = status?.repository || "";
  const prefix = root?.folder.startsWith(`${repository}/`)
    ? `${root.folder.slice(repository.length + 1)}/`
    : "";
  const editorPath = (file: string) =>
    file.startsWith(prefix) && root?.files.includes(file.slice(prefix.length))
      ? file.slice(prefix.length)
      : "";
  return (
    <>
      <button
        className="button small git-toggle"
        disabled={!roots.length}
        onClick={async () => {
          setShow(true);
          setError("");
          setNotice("");
          try {
            const saved = await save();
            if (saved)
              setNotice(`Saved ${saved} so the review includes your edits.`);
            await refresh();
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        <GitBranch size={14} />
        {status?.connected ? `Git · ${status.branch}` : "Git"}
        {!clean && <small>{changes.length}</small>}
        {!!status?.ahead && (
          <span className="git-outgoing">
            <ArrowUp size={11} />
            {status.ahead}
          </span>
        )}
      </button>
      {show && (
        <Modal
          title={
            <>
              <GitBranch size={19} /> Source control
            </>
          }
          onClose={() => setShow(false)}
          locked={!!busy}
          className="git-modal"
        >
          <div className="git-heading-tools">
            {locked && (
              <span className="git-progress">
                <LoaderCircle size={13} className="spin" />
                {busy ? `Git ${busy}…` : "Checking repository…"}
              </span>
            )}
            {roots.length > 1 && (
              <select
                aria-label="Local folder"
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
          {error && (
            <div className="git-error" role="alert">
              <pre>{error}</pre>
              <button
                className="button small"
                onClick={() => {
                  setShow(false);
                  onOpenTerminal();
                }}
              >
                Open local terminal
              </button>
            </div>
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
                  {!clean
                    ? `Changes · ${changes.length}`
                    : connected
                      ? "Working tree clean"
                      : "Track your manuscript"}
                </strong>
                {!clean && (
                  <label className="git-select-all">
                    <input
                      type="checkbox"
                      aria-label="Select all changes"
                      checked={selected.length === changes.length}
                      disabled={locked}
                      onChange={(event) =>
                        setExcluded(
                          new Set(
                            event.target.checked
                              ? []
                              : changes.map((change) => change.file),
                          ),
                        )
                      }
                    />
                    {selected.length} selected
                  </label>
                )}
              </div>
              {!clean ? (
                <div className="git-review-grid">
                  <div className="git-changes">
                    {changes.map((change) => {
                      const label = changeLabel(change.status);
                      const local = editorPath(change.file);
                      return (
                        <div
                          key={change.file}
                          className={focused === change.file ? "active" : ""}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Include ${change.file} in commit`}
                            checked={!excluded.has(change.file)}
                            disabled={locked || hasConflict}
                            onChange={() =>
                              setExcluded((current) => {
                                const next = new Set(current);
                                if (!next.delete(change.file))
                                  next.add(change.file);
                                return next;
                              })
                            }
                          />
                          <button
                            onClick={() => setActiveFile(change.file)}
                            title={change.file}
                          >
                            <FileDiff size={14} />
                            <span>{change.file}</span>
                            <code title={label} data-status={label[0]}>
                              {label[0]}
                            </code>
                          </button>
                          {local && (
                            <button
                              className="icon-button"
                              title="Open in editor"
                              aria-label={`Open ${change.file} in editor`}
                              disabled={!!busy}
                              onClick={() => {
                                setShow(false);
                                onOpenFile(local, available!);
                              }}
                            >
                              <FilePen size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
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
                      {rows ? (
                        <pre>
                          {rows.map(({ line, kind, left, right }, index) => (
                            <div key={index} className={kind}>
                              <span className="git-diff-line">{left}</span>
                              <span className="git-diff-line">{right}</span>
                              <code>{line || " "}</code>
                            </div>
                          ))}
                        </pre>
                      ) : (
                        <p>
                          {preview?.text ||
                            previewError ||
                            "Loading difference…"}
                        </p>
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
                  {connected ? (
                    <CheckCheck size={28} />
                  ) : (
                    <GitBranch size={28} />
                  )}
                  <strong>
                    {connected
                      ? "Your files match the last commit"
                      : "A version history for your research"}
                  </strong>
                  <p>
                    {connected
                      ? "Your next edits will appear here. Review each file before creating a commit."
                      : "Initialize this local folder, or connect an existing remote to begin tracking your work."}
                  </p>
                  {status && !connected && (
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
                        <strong title={commit.subject}>{commit.subject}</strong>
                        <small>
                          {commit.author} · {monthDay(commit.date)}
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
                      disabled={locked || !connected}
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
                      ? `${plural(selected.length, "file")} included · saves locally`
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
                      onClick={() => void window.research!.openLink(remotePage)}
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
                        ? `Last checked ${checkedAt}`
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
                            locked || blocked || !!status.behind || !hasHistory
                          }
                          onClick={() => void operate("push")}
                        >
                          <ArrowUp size={14} />
                          Push
                        </button>
                        <button
                          className="button primary small"
                          disabled={
                            locked || blocked || divergent || !hasHistory
                          }
                          onClick={() => void operate("sync")}
                        >
                          <RefreshCw size={14} />
                          Sync
                        </button>
                      </div>
                    </div>
                    <p className="git-caption">{syncHint}</p>
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
                        {connected
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
                        Use an existing repository URL. Authentication uses your
                        configured Git credentials or SSH key.
                      </p>
                    </form>
                  )
                )}
              </section>
            </aside>
          </div>
        </Modal>
      )}
    </>
  );
});
