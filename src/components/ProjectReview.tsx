import { useEffect, useState } from "react";
import {
  CheckCheck,
  GitCommitHorizontal,
  MessageSquareText,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  GitStatus,
  Project,
  ProjectChanges,
  ReviewRequest,
} from "../types";
import { timeLabel } from "../dates";
import { BlurField } from "./ui";
import "../portfolio.css";

export default function ProjectReview({
  project,
  update,
  report,
}: {
  project: Project;
  update(changes: ProjectChanges, undo?: string): void;
  report(message: string): void;
}) {
  const [history, setHistory] = useState<NonNullable<GitStatus["history"]>>([]);
  const [revision, setRevision] = useState("");
  const [title, setTitle] = useState("");
  const [decision, setDecision] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [gitError, setGitError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGitError("");
    setHistory([]);
    setRevision("");
    if (!project.folder) {
      setLoading(false);
      return;
    }
    void window
      .research!.gitStatus(project.id, "primary")
      .then(
        (status) => {
          if (cancelled) return;
          const commits = status.history || [];
          setHistory(commits);
          setRevision(commits[0]?.hash || "");
        },
        (error: Error) => {
          if (!cancelled) setGitError(error.message);
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.folder, refresh]);
  const stamp = () => new Date().toISOString();
  const selected = history.some((item) => item.hash === revision)
    ? revision
    : "";
  const reviseReview = (id: string, changes: Partial<ReviewRequest>) =>
    update((latest) => ({
      reviewRequests: (latest.reviewRequests || []).map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
      lastSubstantiveUpdate: stamp(),
    }));
  const markReviewed = (id?: string) => {
    if (!selected) {
      report("Choose a committed revision to record this review.");
      return;
    }
    const now = stamp();
    update((latest) => ({
      lastReviewedCommit: selected,
      lastSubstantiveUpdate: now,
      ...(id
        ? {
            reviewRequests: (latest.reviewRequests || []).map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: "reviewed" as const,
                    reviewedAt: now,
                    reviewedRevision: selected,
                  }
                : item,
            ),
          }
        : {}),
    }));
  };
  return (
    <section className="detail-card project-review">
      <div className="section-heading">
        <h2>
          <MessageSquareText size={17} /> Reviews & decisions
        </h2>
      </div>
      <label>
        Manuscript revision
        <div className="review-revision-picker">
          <select
            aria-label="Manuscript revision for review"
            value={revision}
            disabled={loading || !history.length}
            onChange={(event) => setRevision(event.target.value)}
          >
            {!history.length && (
              <option value="">
                {loading
                  ? "Reading revisions…"
                  : "No committed revision available"}
              </option>
            )}
            {history.map((commit) => (
              <option key={commit.hash} value={commit.hash}>
                {commit.hash.slice(0, 8)} · {commit.subject}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="Refresh manuscript revisions"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </label>
      {gitError && (
        <p className="form-help" role="status">
          {gitError}
        </p>
      )}
      <p className="form-help">
        Choose the saved commit being requested or reviewed. Commit manuscript
        changes in the workbench before recording a new revision.
      </p>
      {selected && (
        <p className="review-commit" title={selected}>
          <GitCommitHorizontal size={14} /> Selected: <code>{selected}</code>
        </p>
      )}
      <button
        className="button small"
        disabled={!selected}
        onClick={() => markReviewed()}
      >
        <CheckCheck size={14} /> Mark selected revision reviewed
      </button>
      {project.lastReviewedCommit && (
        <p className="form-help">
          Last reviewed commit:{" "}
          <code title={project.lastReviewedCommit}>
            {project.lastReviewedCommit.slice(0, 12)}
          </code>
        </p>
      )}
      <form
        className="review-request-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || !selected) return;
          const now = stamp();
          const request: ReviewRequest = {
            id: crypto.randomUUID(),
            title: title.trim(),
            revision: selected,
            requestedAt: now,
            status: "requested",
          };
          update((latest) => ({
            reviewRequests: [...(latest.reviewRequests || []), request],
            lastSubstantiveUpdate: now,
          }));
          setTitle("");
        }}
      >
        <label>
          Request a review
          <input
            value={title}
            maxLength={2000}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="For example: Review the evaluation section"
          />
        </label>
        <button className="button small" disabled={!title.trim() || !selected}>
          <Plus size={14} /> Request review
        </button>
      </form>
      <div className="review-list">
        {[...(project.reviewRequests || [])].reverse().map((review) => (
          <article key={review.id} className="review-item">
            <BlurField
              aria-label={`Review request ${review.title}`}
              required
              value={review.title}
              onCommit={(value) => reviseReview(review.id, { title: value })}
            />
            <p className="form-help">
              <strong>
                {review.status === "in-review"
                  ? "In review"
                  : review.status === "reviewed"
                    ? "Reviewed"
                    : "Requested"}
              </strong>{" "}
              · {timeLabel(review.requestedAt)} · Requested{" "}
              <code title={review.revision}>{review.revision.slice(0, 8)}</code>
            </p>
            {review.reviewedAt && (
              <p className="form-help">
                Reviewed {timeLabel(review.reviewedAt)} at{" "}
                <code title={review.reviewedRevision}>
                  {review.reviewedRevision?.slice(0, 8)}
                </code>
              </p>
            )}
            <div className="review-actions">
              {review.status === "requested" && (
                <button
                  className="button small"
                  onClick={() =>
                    reviseReview(review.id, { status: "in-review" })
                  }
                >
                  Start review
                </button>
              )}
              {review.status !== "reviewed" && (
                <button
                  className="button small"
                  disabled={!selected}
                  title="Records the revision selected above"
                  onClick={() => markReviewed(review.id)}
                >
                  Mark reviewed at{" "}
                  {selected ? selected.slice(0, 8) : "selected revision"}
                </button>
              )}
              {review.status === "reviewed" && (
                <button
                  className="button small"
                  onClick={() =>
                    reviseReview(review.id, {
                      status: "requested",
                      reviewedAt: undefined,
                      reviewedRevision: undefined,
                    })
                  }
                >
                  Reopen request
                </button>
              )}
              <button
                className="icon-button"
                aria-label={`Remove review request ${review.title}`}
                onClick={() =>
                  update(
                    (latest) => ({
                      reviewRequests: (latest.reviewRequests || []).filter(
                        (item) => item.id !== review.id,
                      ),
                    }),
                    "Removed review request",
                  )
                }
              >
                <X size={13} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <form
        className="review-request-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!decision.trim()) return;
          const now = stamp();
          update((latest) => ({
            decisions: [
              ...(latest.decisions || []),
              {
                id: crypto.randomUUID(),
                text: decision.trim(),
                createdAt: now,
                ...(selected ? { revision: selected } : {}),
              },
            ],
            lastSubstantiveUpdate: now,
          }));
          setDecision("");
        }}
      >
        <label>
          Record a decision
          <textarea
            rows={3}
            value={decision}
            maxLength={12000}
            onChange={(event) => setDecision(event.target.value)}
            placeholder="What did the team decide, and why?"
          />
        </label>
        <p className="form-help">
          {selected
            ? `This decision will refer to commit ${selected.slice(0, 8)}.`
            : "This decision will be recorded without a manuscript revision."}
        </p>
        <button className="button small" disabled={!decision.trim()}>
          <Plus size={14} /> Record decision
        </button>
      </form>
      {[...(project.decisions || [])].reverse().map((item) => (
        <article className="review-item" key={item.id}>
          <BlurField
            aria-label="Project decision"
            required
            multiline
            rows={2}
            value={item.text}
            onCommit={(text) =>
              update((latest) => ({
                decisions: (latest.decisions || []).map((decision) =>
                  decision.id === item.id ? { ...decision, text } : decision,
                ),
                lastSubstantiveUpdate: stamp(),
              }))
            }
          />
          <p className="form-help">
            {timeLabel(item.createdAt)}
            {item.revision && (
              <>
                {" "}
                · <code title={item.revision}>{item.revision.slice(0, 8)}</code>
              </>
            )}
          </p>
        </article>
      ))}
    </section>
  );
}
