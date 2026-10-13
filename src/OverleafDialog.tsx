import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import Modal from "./Modal";
import type { Project, Workspace } from "./types";
import type { OverleafStatus } from "./release-types";
import { exclusive } from "./workspace-lock";

const docs =
  "https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens";
async function flushDrafts() {
  const pending: Promise<void>[] = [];
  window.dispatchEvent(
    new CustomEvent("research:flush-drafts", { detail: pending }),
  );
  await Promise.all(pending);
}
export default function OverleafDialog({
  project,
  close,
  imported,
}: {
  project?: Project;
  close(): void;
  imported(workspace: Workspace, projectId: string): void;
}) {
  const [id, setId] = useState(project?.id || "");
  const [name, setName] = useState(project?.name || "");
  const [url, setUrl] = useState(
    project?.links?.find((link) => /overleaf\.com\/project\//.test(link.url))
      ?.url || "",
  );
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"review" | "publish">("review");
  const [clone, setClone] = useState(!project?.folder);
  const [status, setStatus] = useState<OverleafStatus>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("Reviewed manuscript changes");
  const [selected, setSelected] = useState<string[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const tx = status?.transaction;
  const active = tx && !["cancelled", "published"].includes(tx.stage);
  const staleRemote =
    !!active &&
    tx.stage !== "publishing" &&
    status?.remoteHead !== tx.remoteHead;
  const staleLocal =
    !!active &&
    status?.head !== (tx.stage === "applied" ? tx.resultHead : tx.baseHead);
  const compileCurrent =
    !!tx?.compile?.ok &&
    !!tx.reviewToken &&
    tx.compile.reviewToken === tx.reviewToken;
  useEffect(() => {
    setAccepted(false);
  }, [tx?.id, tx?.reviewToken, mode]);
  useEffect(() => {
    setResolutions({});
  }, [tx?.id]);
  async function refresh(projectId = id) {
    if (!projectId) return;
    const next = await window.research!.overleafStatus(projectId);
    setStatus(next);
    if (next.connection) setMode(next.connection.mode);
    setSelected((old) =>
      old.filter((file) =>
        next.changes?.some((change) => change.file === file),
      ),
    );
    return next;
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [id]);
  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy("");
    }
  }
  async function connect() {
    await run("Connecting…", () =>
      exclusive(async () => {
        await flushDrafts();
        const result = await window.research!.overleafConnect({
          projectId: id || undefined,
          name,
          url,
          token: token || undefined,
          mode,
          clone,
        });
        if (!result) return;
        setToken("");
        setId(result.projectId);
        imported(result.workspace, result.projectId);
        await refresh(result.projectId);
        setNotice("Connected. Check for coauthor changes when you are ready.");
      }),
    );
  }
  async function action(kind: string, extra: Record<string, unknown> = {}) {
    if (["plan", "apply", "checkpoint", "publish", "restore"].includes(kind))
      await flushDrafts();
    const result = await window.research!.overleafAction(id, kind, {
      transactionId: tx?.id,
      expectedHead: status?.head,
      expectedRemoteHead: status?.remoteHead,
      reviewToken: tx?.reviewToken,
      ...extra,
    });
    if (["apply", "restore"].includes(kind)) {
      window.dispatchEvent(
        new CustomEvent("research:repository-updated", {
          detail: { projectId: id },
        }),
      );
      setNotice(
        kind === "restore"
          ? "The local manuscript was restored to its checkpoint. Overleaf was not changed."
          : "Reviewed source applied locally. Publishing remains a separate step.",
      );
    }
    if (kind === "compile")
      setNotice(result?.message || "Compilation finished.");
    if (kind === "publish") {
      setNotice("Published the reviewed source to Overleaf.");
      setAccepted(false);
    }
    if (kind === "cancel")
      setNotice(
        tx?.stage === "applied"
          ? "Review closed. The applied local source is retained."
          : "Review closed. Manuscript source was not changed.",
      );
  }
  return (
    <Modal
      title={status?.connected ? "Overleaf manuscript" : "Connect Overleaf"}
      onClose={close}
      locked={!!busy}
    >
      <div className="overleaf-dialog">
        <p className="muted">
          Work locally and keep the original project available to your
          coauthors.
        </p>
        <div className="overleaf-warning">
          Source publishing can displace Overleaf comments or tracked changes.
          Use review mode while your team reviews in Overleaf. Shared comments
          and live presence remain in Overleaf.
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {busy && (
          <p role="status">
            <LoaderCircle className="spin" size={15} /> {busy}
          </p>
        )}
        {!status?.connected ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            {!project && (
              <label>
                Project name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My manuscript"
                  maxLength={100}
                />
              </label>
            )}
            <label>
              Overleaf project URL
              <input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.overleaf.com/project/…"
                autoComplete="off"
              />
            </label>
            <label>
              Git authentication token
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Stored securely on this Mac"
              />
            </label>
            <p className="form-help">
              Git access requires an eligible Overleaf project. Use your own
              token. Credentials stay outside manuscript files and workspace
              exports.
            </p>
            <button
              className="button small"
              type="button"
              onClick={() => void window.research!.openLink(docs)}
            >
              Token setup instructions <ExternalLink size={12} />
            </button>
            {project?.folder && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={clone}
                  onChange={(e) => setClone(e.target.checked)}
                />{" "}
                Clone into a new folder and attach it to this project
              </label>
            )}
            {!clone && (
              <p className="form-help">
                Connect the attached Git repository. Its history must relate to
                the Overleaf project. For an extracted ZIP, clone first and copy
                your edits into the clone.
              </p>
            )}
            <label>
              Connection mode
              <select
                aria-label="Connection mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="review">
                  Review: retrieve and inspect source
                </option>
                <option value="publish">
                  Write and publish: reviewed source changes
                </option>
              </select>
            </label>
            <div className="modal-actions">
              <button
                className="button primary"
                disabled={!!busy || !url.trim()}
              >
                {clone ? "Choose folder and clone" : "Connect this folder"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="overleaf-status">
              <dt>Project</dt>
              <dd>{status.connection?.projectUrl}</dd>
              <dt>Published branch</dt>
              <dd>{status.connection?.remoteBranch}</dd>
              <dt>Last checked</dt>
              <dd>
                {status.connection?.lastFetchedAt
                  ? new Date(status.connection.lastFetchedAt).toLocaleString()
                  : "Not checked yet"}
              </dd>
              <dt>Last published</dt>
              <dd>
                {status.connection?.lastPublishedAt
                  ? new Date(status.connection.lastPublishedAt).toLocaleString()
                  : "No publication from this app"}
              </dd>
              <dt>Source state</dt>
              <dd>
                {status.dirty ? "Uncommitted changes" : "Saved and committed"} ·{" "}
                {status.ahead || 0} outgoing · {status.behind || 0} incoming
              </dd>
            </dl>
            <div className="overleaf-actions">
              <button
                className="button"
                disabled={!!busy}
                onClick={() =>
                  void run("Checking coauthor changes…", () => action("check"))
                }
              >
                <RefreshCw size={14} /> Check coauthor changes
              </button>
              <button
                className="button"
                onClick={() =>
                  void window.research!.openLink(status.connection!.projectUrl)
                }
              >
                Open in Overleaf <ExternalLink size={14} />
              </button>
              <button
                className="button"
                disabled={!!busy || tx?.stage === "publishing"}
                onClick={() =>
                  void run("Changing mode…", () =>
                    action("mode", {
                      mode: mode === "review" ? "publish" : "review",
                    }),
                  )
                }
              >
                Switch to {mode === "review" ? "write and publish" : "review"}
              </button>
            </div>
            <p className="form-help">
              Mode:{" "}
              {mode === "review"
                ? "Review. Publication is disabled."
                : "Write and publish. Every publication requires review and a successful build."}
            </p>
            {status.dirty && !active && (
              <section>
                <h3>Create a local checkpoint</h3>
                <p className="form-help">
                  Save editor drafts first. Select the source files to commit;
                  generated build files stay excluded.
                </p>
                <div className="overleaf-files">
                  {status.changes?.map((change) => (
                    <label className="inline-check" key={change.file}>
                      <input
                        type="checkbox"
                        checked={selected.includes(change.file)}
                        onChange={(e) =>
                          setSelected((files) =>
                            e.target.checked
                              ? [...files, change.file]
                              : files.filter((f) => f !== change.file),
                          )
                        }
                      />
                      {change.status} {change.file}
                    </label>
                  ))}
                </div>
                <label>
                  Checkpoint message
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={1000}
                  />
                </label>
                <button
                  className="button"
                  disabled={!!busy || !selected.length || !message.trim()}
                  onClick={() =>
                    void run("Creating checkpoint…", () =>
                      action("checkpoint", { message, files: selected }),
                    )
                  }
                >
                  Commit selected source
                </button>
              </section>
            )}
            {!active && (
              <button
                className="button primary"
                disabled={!!busy || status.dirty}
                onClick={() =>
                  void run("Preparing source review…", () => action("plan"))
                }
              >
                Review incoming and local changes
              </button>
            )}
            {tx && (
              <section>
                <h3>Source review · {tx.stage}</h3>
                {tx.stage === "publishing" && (
                  <p role="alert">
                    The publication outcome needs confirmation. Check coauthor
                    changes before retrying or closing the review. You can
                    update an expired token in Connection settings.
                  </p>
                )}
                {(staleLocal || staleRemote) && tx.stage !== "publishing" && (
                  <p role="alert">
                    {staleRemote
                      ? "Overleaf has a newer revision."
                      : "The local manuscript revision changed."}{" "}
                    Close this review, save and commit any local edits, then
                    prepare a new source review.
                  </p>
                )}
                {tx.error && <p role="alert">{tx.error}</p>}
                {!!tx.files?.length && (
                  <ul className="overleaf-files">
                    {tx.files.map((file) => (
                      <li key={file.file}>
                        {file.status} {file.file}
                      </li>
                    ))}
                  </ul>
                )}
                {tx.incomingDiff?.text && (
                  <details open>
                    <summary>Incoming coauthor changes</summary>
                    <pre className="overleaf-diff">{tx.incomingDiff.text}</pre>
                    {tx.incomingDiff.truncated && (
                      <p>
                        Incoming diff truncated; inspect the complete
                        manuscript.
                      </p>
                    )}
                  </details>
                )}
                {tx.diff?.text && (
                  <details open>
                    <summary>Proposed publication differences</summary>
                    <pre className="overleaf-diff">{tx.diff.text}</pre>
                    {tx.diff.truncated && (
                      <p className="form-help">
                        The diff is truncated. Inspect the complete manuscript
                        before publishing.
                      </p>
                    )}
                  </details>
                )}
                {tx.conflicts?.map((conflict) => (
                  <div className="overleaf-conflict" key={conflict.file}>
                    <strong>Resolve {conflict.file}</strong>
                    <div className="overleaf-conflict-columns">
                      <div>
                        Local
                        <pre>
                          {conflict.local.binary
                            ? "Binary file or unavailable preview"
                            : !conflict.local.exists
                              ? "File deleted"
                              : conflict.local.text || "(empty file)"}
                        </pre>
                      </div>
                      <div>
                        Overleaf
                        <pre>
                          {conflict.remote.binary
                            ? "Binary file or unavailable preview"
                            : !conflict.remote.exists
                              ? "File deleted"
                              : conflict.remote.text || "(empty file)"}
                        </pre>
                      </div>
                    </div>
                    <details>
                      <summary>Common base</summary>
                      <pre className="overleaf-diff">
                        {conflict.base.binary
                          ? "Binary file or unavailable preview"
                          : !conflict.base.exists
                            ? "File absent"
                            : conflict.base.text || "(empty file)"}
                      </pre>
                    </details>
                    <div className="overleaf-actions">
                      {(["local", "remote", "base"] as const).map((choice) => (
                        <button
                          className="button small"
                          disabled={!!busy}
                          key={choice}
                          onClick={() =>
                            void run("Resolving conflict…", () =>
                              action("resolve", {
                                file: conflict.file,
                                choice,
                              }),
                            )
                          }
                        >
                          Use {choice === "remote" ? "Overleaf" : choice}
                        </button>
                      ))}
                    </div>
                    {!conflict.local.binary && !conflict.remote.binary && (
                      <>
                        <label>
                          Merged text
                          <textarea
                            value={
                              resolutions[conflict.file] ??
                              conflict.local.text ??
                              ""
                            }
                            onChange={(e) =>
                              setResolutions((items) => ({
                                ...items,
                                [conflict.file]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <button
                          className="button small"
                          disabled={!!busy}
                          onClick={() =>
                            void run("Saving merged text…", () =>
                              action("resolve", {
                                file: conflict.file,
                                choice: "text",
                                text:
                                  resolutions[conflict.file] ??
                                  conflict.local.text ??
                                  "",
                              }),
                            )
                          }
                        >
                          Use merged text
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {tx.stage === "ready" && (
                  <div className="overleaf-actions">
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run("Compiling reviewed manuscript…", () =>
                          action("compile"),
                        )
                      }
                    >
                      Compile review
                    </button>
                    <button
                      className="button primary"
                      disabled={
                        !!busy || staleRemote || staleLocal || status.dirty
                      }
                      onClick={() =>
                        void run("Applying reviewed source…", () =>
                          action("apply", { message }),
                        )
                      }
                    >
                      Apply reviewed source locally
                    </button>
                  </div>
                )}
                {tx.compile && (
                  <p role="status">
                    Build: {tx.compile.ok ? "passed" : "failed"} ·{" "}
                    {tx.compile.message}
                  </p>
                )}
                {compileCurrent && active && (
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() =>
                      void run("Opening reviewed PDF…", () =>
                        action("open-preview"),
                      )
                    }
                  >
                    Open reviewed PDF
                  </button>
                )}
                {tx.stage === "applied" && (
                  <>
                    <p className="form-help">
                      The reviewed revision is now local. Open the workbench to
                      inspect it before publishing.
                    </p>
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run("Compiling reviewed manuscript…", () =>
                          action("compile"),
                        )
                      }
                    >
                      Compile review
                    </button>
                    <button
                      className="button"
                      disabled={!!busy || staleLocal || status.dirty}
                      onClick={() =>
                        void run("Restoring local checkpoint…", () =>
                          action("restore"),
                        )
                      }
                    >
                      Restore local checkpoint
                    </button>
                    <p className="form-help">
                      Restoring returns the local source to the revision before
                      this review. Closing the review keeps the applied source.
                    </p>
                    {mode === "publish" && (
                      <>
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            checked={accepted}
                            onChange={(e) => setAccepted(e.target.checked)}
                          />
                          I reviewed the source and PDF. My team is ready for
                          publication, which may affect Overleaf comments or
                          tracked changes.
                        </label>
                        <button
                          className="button primary"
                          disabled={
                            !!busy ||
                            !accepted ||
                            !compileCurrent ||
                            staleRemote ||
                            staleLocal ||
                            status.dirty
                          }
                          onClick={() =>
                            void run("Publishing reviewed source…", () =>
                              action("publish", {
                                acknowledgeReviewDataLoss: accepted,
                              }),
                            )
                          }
                        >
                          Publish reviewed source
                        </button>
                      </>
                    )}
                  </>
                )}
                {active && (
                  <button
                    className="button"
                    disabled={!!busy || tx.stage === "publishing"}
                    onClick={() =>
                      void run("Closing review…", () => action("cancel"))
                    }
                  >
                    {tx.stage === "applied"
                      ? "Close review and keep local source"
                      : "Close this review"}
                  </button>
                )}
              </section>
            )}
            <details>
              <summary>Connection settings</summary>
              <label>
                Replacement authentication token
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="button"
                disabled={!!busy || !token}
                onClick={() =>
                  void run("Updating credentials…", async () => {
                    await window.research!.overleafReconnect(id, token);
                    setToken("");
                  })
                }
              >
                Update token
              </button>
              <button
                className="button"
                disabled={!!busy || !!active}
                onClick={() =>
                  void run("Disconnecting…", () => action("disconnect"))
                }
              >
                Disconnect Overleaf
              </button>
              <p className="form-help">
                Disconnecting keeps manuscript files on this Mac.
              </p>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}
