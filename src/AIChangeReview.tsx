import { useEffect, useMemo, useState } from "react";
import {
  Check,
  FileDiff,
  FileText,
  LoaderCircle,
  RefreshCw,
  Undo2,
} from "lucide-react";
import Modal from "./Modal";
import { unwrap } from "./ai-result";
import { diffRows } from "./diff";
import type { AIChangeReview as Review, AIReviewedFile } from "./types";
import "./ai-review.css";

const maxLines = 5000;
function SourceVersion({ title, text }: { title: string; text?: string }) {
  const lines = text?.split("\n") || [];
  return (
    <section className="ai-source-version" aria-label={title}>
      <h4>{title}</h4>
      {text === undefined ? (
        <p>File did not exist.</p>
      ) : text === "" ? (
        <p>Empty file.</p>
      ) : (
        <pre tabIndex={0}>
          {lines.slice(0, maxLines).map((line, index) => (
            <div key={index}>
              <span className="ai-diff-number">{index + 1}</span>
              <code>{line || " "}</code>
            </div>
          ))}
        </pre>
      )}
      {lines.length > maxLines && (
        <p>Preview shows the first {maxLines} lines.</p>
      )}
    </section>
  );
}

export default function AIChangeReview({
  projectId,
  messageId,
  agentBusy,
  onClose,
  onRevert,
  openReference,
}: {
  projectId: string;
  messageId: string;
  agentBusy: boolean;
  onClose(): void;
  onRevert(messageId: string): Promise<void>;
  openReference(reference: string): void;
}) {
  const [review, setReview] = useState<Review>();
  const [selected, setSelected] = useState("");
  const [loadedFile, setFile] = useState<AIReviewedFile>();
  const file = loadedFile?.id === selected ? loadedFile : undefined;
  const [view, setView] = useState<"diff" | "versions">("diff");
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [checking, setChecking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    let current = true;
    void unwrap(window.research!.aiReview(projectId, messageId))
      .then((result) => {
        if (!current) return;
        setReview(result);
        setSelected(result.files[0]?.id || "");
      })
      .catch((error: Error) => {
        if (current) setError(error.message);
      });
    return () => {
      current = false;
    };
  }, [projectId, messageId]);
  useEffect(() => {
    let current = true;
    setFile(undefined);
    setFileError("");
    if (selected)
      void unwrap(window.research!.aiReviewFile(projectId, messageId, selected))
        .then((result) => {
          if (current) setFile(result);
        })
        .catch((error: Error) => {
          if (current) setFileError(error.message);
        });
    return () => {
      current = false;
    };
  }, [projectId, messageId, selected]);
  const rows = useMemo(() => file && diffRows(file.diff), [file]);
  async function refresh() {
    setChecking(true);
    setError("");
    try {
      setReview(await unwrap(window.research!.aiReview(projectId, messageId)));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setChecking(false);
    }
  }
  async function revert() {
    setRestoring(true);
    setError("");
    try {
      await onRevert(messageId);
      setReview(await unwrap(window.research!.aiReview(projectId, messageId)));
    } catch (error) {
      setError((error as Error).message);
      try {
        setReview(
          await unwrap(window.research!.aiReview(projectId, messageId)),
        );
      } catch {
        /* Keep the error visible. */
      }
    } finally {
      setRestoring(false);
    }
  }
  const active = review?.files.find((item) => item.id === selected);
  function lineNumber(value: number | undefined, version: "before" | "after") {
    const currentVersion = review?.revertedAt ? "before" : "after";
    if (
      value &&
      file &&
      version === currentVersion &&
      file.kind !== (version === "before" ? "added" : "deleted")
    )
      return (
        <button
          className="ai-diff-number"
          type="button"
          title={"Open line " + value}
          aria-label={"Open line " + value}
          onClick={() =>
            openReference((file.absolutePath || file.path) + ":" + value)
          }
        >
          {value}
        </button>
      );
    return <span className="ai-diff-number">{value}</span>;
  }
  const reason = agentBusy
    ? "Stop the agent and pause its queue before reverting changes."
    : review?.reason;
  return (
    <Modal
      title={
        <>
          <FileDiff size={19} /> Review changes
        </>
      }
      onClose={onClose}
      locked={restoring}
      className="ai-review-modal"
    >
      <p className="ai-review-subtitle">
        {review
          ? review.files.length +
            " changed " +
            (review.files.length === 1 ? "file" : "files") +
            " in this run"
          : "Loading changes…"}
        <span> · Compared to the files before this request</span>
      </p>
      <div className="ai-review-workspace">
        <nav className="ai-review-files" aria-label="Changed files">
          {review?.files.map((item) => (
            <button
              type="button"
              key={item.id}
              className={selected === item.id ? "active" : ""}
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
            >
              <FileText size={14} />
              <span>
                <strong title={item.path}>{item.path}</strong>
                <small>{item.folder}</small>
              </span>
              <small className={"ai-file-kind " + item.kind}>
                {item.kind === "added"
                  ? "A"
                  : item.kind === "deleted"
                    ? "D"
                    : "M"}
              </small>
            </button>
          ))}
          {review && !review.files.length && <p>No project files changed.</p>}
        </nav>
        <div className="ai-review-content">
          {active && (
            <div className="ai-review-toolbar">
              <span title={active.path}>{active.path}</span>
              <div role="group" aria-label="Review view">
                <button
                  type="button"
                  aria-pressed={view === "diff"}
                  onClick={() => setView("diff")}
                >
                  Diff
                </button>
                <button
                  type="button"
                  aria-pressed={view === "versions"}
                  disabled={active.snapshot === false || active.binary}
                  onClick={() => setView("versions")}
                >
                  Before &amp; after
                </button>
              </div>
              {(review?.revertedAt
                ? active.kind !== "added"
                : active.kind !== "deleted") && (
                <button
                  type="button"
                  onClick={() =>
                    openReference(active.absolutePath || active.path)
                  }
                >
                  Open file
                </button>
              )}
            </div>
          )}
          {fileError ? (
            <p role="alert">{fileError}</p>
          ) : selected && !file ? (
            <p role="status">Loading file…</p>
          ) : (
            file && (
              <>
                {file.beforeMode !== file.afterMode && (
                  <p className="ai-mode-change">
                    Permissions: {file.beforeMode?.toString(8) || "absent"} →{" "}
                    {file.afterMode?.toString(8) || "absent"}
                  </p>
                )}
                {file.binary ? (
                  <p className="ai-review-empty">
                    Binary file: {file.beforeBytes.toLocaleString()} →{" "}
                    {file.afterBytes.toLocaleString()} bytes.
                    <br />
                    Revert restores the exact original bytes.
                  </p>
                ) : view === "versions" && file.snapshot !== false ? (
                  <div className="ai-source-versions">
                    <SourceVersion
                      title="Before this request"
                      text={file.before}
                    />
                    <SourceVersion
                      title="After this request"
                      text={file.after}
                    />
                  </div>
                ) : (
                  <div
                    className="ai-file-diff"
                    role="region"
                    aria-label="File changes"
                    tabIndex={0}
                  >
                    {rows ? (
                      <pre>
                        {rows
                          .slice(0, maxLines)
                          .map(({ line, kind, left, right }, index) => (
                            <div key={index} className={kind}>
                              {lineNumber(left, "before")}
                              {lineNumber(right, "after")}
                              <code>{line || " "}</code>
                            </div>
                          ))}
                      </pre>
                    ) : (
                      <pre className="ai-saved-patch">
                        {file.diff || "No text changes."}
                      </pre>
                    )}
                    {!!rows && rows.length > maxLines && (
                      <p>Preview shows the first {maxLines} diff rows.</p>
                    )}
                  </div>
                )}
                {file.truncated && (
                  <p className="ai-review-preview-note">
                    This preview is shortened. Saved versions used for revert
                    retain the complete file.
                  </p>
                )}
              </>
            )
          )}
        </div>
      </div>
      <footer className="ai-review-footer">
        <div>
          {error && (
            <p role="alert" className="ai-review-error">
              {error}
            </p>
          )}
          {review?.revertedAt ? (
            <p className="ai-reverted">
              <Check size={14} /> This run was reverted. Its saved diff remains
              available.
            </p>
          ) : (
            reason && <p>{reason}</p>
          )}
          {review?.warnings
            .filter((warning) => warning !== reason)
            .map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
        </div>
        <button
          type="button"
          className="secondary"
          disabled={checking || restoring || !review}
          onClick={() => void refresh()}
          title="Check whether these files can be reverted"
        >
          <RefreshCw size={14} className={checking ? "spin" : ""} /> Check files
        </button>
        <button
          type="button"
          className="ai-revert-action"
          disabled={
            !review?.canRevert ||
            agentBusy ||
            restoring ||
            checking ||
            !file ||
            !!fileError
          }
          onClick={() => void revert()}
        >
          {restoring ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Undo2 size={14} />
          )}
          {restoring ? "Reverting…" : "Revert this run"}
        </button>
      </footer>
    </Modal>
  );
}
