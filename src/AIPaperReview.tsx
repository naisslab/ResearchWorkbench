import { useEffect, useRef, useState } from "react";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfWorker } from "./pdf-worker";
import { unwrap } from "./ai-result";
import type { AIPaperReview as Review } from "./types";

function PaperPage({ doc, page }: { doc?: PDFDocumentProxy; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!doc || page > doc.numPages) return;
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setError("");
    void doc
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled || !canvas.current) return;
        const node = canvas.current;
        const viewport = pdfPage.getViewport({
          scale: 900 / pdfPage.getViewport({ scale: 1 }).width,
        });
        node.width = viewport.width;
        node.height = viewport.height;
        task = pdfPage.render({ canvas: node, viewport });
        await task.promise;
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page]);
  if (!doc || page > doc.numPages) return <p>No page available.</p>;
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <canvas ref={canvas} aria-label={`PDF page ${page}`} />
    </>
  );
}

async function pageSignature(
  doc: PDFDocumentProxy | undefined,
  number: number,
) {
  if (!doc || number > doc.numPages) return "missing";
  const page = await doc.getPage(number);
  const viewport = page.getViewport({
    scale: 200 / page.getViewport({ scale: 1 }).width,
  });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, viewport }).promise;
  const pixels = canvas
    .getContext("2d")!
    .getImageData(0, 0, canvas.width, canvas.height);
  const digest = await crypto.subtle.digest("SHA-256", pixels.data);
  return (
    `${canvas.width}:${canvas.height}:` + [...new Uint8Array(digest)].join(",")
  );
}

export default function AIPaperReview({
  projectId,
  messageId,
  disabled,
  prepare,
  changed,
  compiling,
  onBusy,
}: {
  projectId: string;
  messageId: string;
  disabled: boolean;
  prepare(): Promise<void>;
  changed(): Promise<void>;
  compiling: boolean;
  onBusy(busy: boolean): void;
}) {
  const [review, setReview] = useState<Review>();
  const [documents, setDocuments] = useState<{
    before?: PDFDocumentProxy;
    after?: PDFDocumentProxy;
  }>({});
  const [page, setPage] = useState(1);
  const [different, setDifferent] = useState<number[]>([]);
  const [scan, setScan] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void unwrap(window.research!.aiPaper(projectId, messageId))
      .then((value) => {
        if (!cancelled) setReview(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, messageId]);
  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    const tasks: ReturnType<typeof getDocument>[] = [];
    setDocuments({});
    setDifferent([]);
    setPage(1);
    setScan("Loading saved PDFs…");
    void (async () => {
      await loadPdfWorker();
      const docs: typeof documents = {};
      for (const side of ["before", "after"] as const) {
        if (cancelled) return;
        const data = review[side]?.data;
        if (data) {
          const task = getDocument({
            data: new Uint8Array(data),
            isEvalSupported: false,
          });
          tasks.push(task);
          docs[side] = await task.promise;
        }
      }
      if (cancelled) return;
      setDocuments(docs);
      if (!docs.before || !docs.after) {
        setScan("Both saved PDFs are needed to compare pages.");
        return;
      }
      if (review.before?.hash === review.after?.hash) {
        setScan(
          "The captured PDFs are identical. Source edits may still need compilation.",
        );
        return;
      }
      const total = Math.max(docs.before.numPages, docs.after.numPages);
      const limit = Math.min(100, total);
      const found: number[] = [];
      for (let i = 1; i <= limit; i++) {
        if (cancelled) return;
        setScan(`Comparing page ${i} of ${limit}…`);
        const before = await pageSignature(docs.before, i);
        if (cancelled) return;
        const after = await pageSignature(docs.after, i);
        if (cancelled) return;
        if (before !== after) {
          found.push(i);
          setDifferent([...found]);
        }
      }
      setScan(
        `Compared ${limit} of ${total} pages at thumbnail resolution. Small changes may need closer inspection.`,
      );
    })().catch((e) => {
      if (!cancelled) {
        setError(e.message);
        setScan("");
      }
    });
    return () => {
      cancelled = true;
      for (const task of tasks) void task.destroy();
    };
  }, [review]);
  async function compile() {
    onBusy(true);
    setError("");
    try {
      await prepare();
      setReview(
        await unwrap(window.research!.aiPaperBuild(projectId, messageId)),
      );
      await changed();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      onBusy(false);
    }
  }
  const total = Math.max(
    documents.before?.numPages || 0,
    documents.after?.numPages || 0,
    1,
  );
  const addedWarnings = (
    review?.build?.warnings ||
    review?.after?.warnings ||
    []
  ).filter((warning) => !review?.before?.warnings?.includes(warning));
  return (
    <section className="ai-paper-review" aria-label="Paper review">
      <div className="ai-paper-toolbar">
        <button
          className="button small"
          disabled={disabled || compiling || !review?.canVerify}
          onClick={() => void compile()}
        >
          {compiling ? "Compiling…" : "Compile and verify this run"}
        </button>
        {compiling && (
          <button
            className="button small"
            onClick={() => void window.research!.cancelCompile(projectId)}
          >
            Stop compilation
          </button>
        )}
        <span role="status">
          {review?.build
            ? review.build.ok
              ? "Verified build succeeded"
              : "Build failed; the PDF may be from an earlier build"
            : "No verified build recorded for this run"}
        </span>
      </div>
      <p>
        Before shows the PDF available when the run started; it may predate
        source edits. Verification compiles only while project files still match
        this run.
      </p>
      {review?.note && <p>{review.note}</p>}
      {review?.interrupted && (
        <p>
          This run was recovered after an interruption. Its final PDF may
          include later work.
        </p>
      )}
      {error && (
        <p role="alert" className="ai-review-error">
          {error}
        </p>
      )}
      {review?.build && (
        <details>
          <summary>
            Build log · {new Date(review.build.at).toLocaleString()}
          </summary>
          <pre>{review.build.log}</pre>
        </details>
      )}
      {!!addedWarnings.length && (
        <details open>
          <summary>New warnings ({addedWarnings.length})</summary>
          {addedWarnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </details>
      )}
      <div className="ai-paper-toolbar">
        <button
          className="button small"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous page
        </button>
        <label>
          Page{" "}
          <input
            aria-label="Review PDF page"
            type="number"
            min={1}
            max={total}
            value={page}
            onChange={(e) =>
              setPage(Math.max(1, Math.min(total, Number(e.target.value) || 1)))
            }
          />{" "}
          / {total}
        </label>
        <button
          className="button small"
          disabled={page >= total}
          onClick={() => setPage(page + 1)}
        >
          Next page
        </button>
      </div>
      <p role="status">{scan}</p>
      {!!different.length && (
        <div className="ai-paper-pages">
          Changed page previews:{" "}
          {different.map((number) => (
            <button
              className="button small"
              key={number}
              onClick={() => setPage(number)}
            >
              {number}
            </button>
          ))}
        </div>
      )}
      <p>
        Pages are paired by number. Added or removed text can shift content to
        another page.
      </p>
      <div className="ai-paper-columns">
        {(["before", "after"] as const).map((side) => (
          <section key={side}>
            <h4>
              {side === "before"
                ? "Before this run"
                : review?.build
                  ? "After verification"
                  : "At run completion"}{" "}
              {documents[side] &&
                `· ${documents[side]!.numPages} ${documents[side]!.numPages === 1 ? "page" : "pages"}`}
            </h4>
            {review?.[side]?.note && <p>{review[side]!.note}</p>}
            <PaperPage doc={documents[side]} page={page} />
          </section>
        ))}
      </div>
    </section>
  );
}
