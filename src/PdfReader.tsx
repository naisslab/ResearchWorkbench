import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/display_utils";
import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?raw";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  History,
  LoaderCircle,
  MessageSquare,
  MousePointer2,
  NotebookPen,
  Pencil,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  AnnotationColor,
  PdfAnnotation,
  PdfPoint,
  PdfVersion,
} from "./pdf-types";

// The worker is bundled locally. A blob module also works in the packaged file:// renderer.
GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob([workerSource], { type: "text/javascript" }),
);
const colors: Record<AnnotationColor, string> = {
  yellow: "#eabf3d",
  green: "#4dad6e",
  blue: "#4d94db",
  rose: "#d6668d",
};
type Tool = "select" | "highlight" | "note" | "ink";
const queuedSaves = new Map<string, Promise<unknown>>();
function queueSave(
  projectId: string,
  url: string,
  annotations: PdfAnnotation[],
  pages: number,
) {
  const key = `${projectId}:${url}`;
  const next = (queuedSaves.get(key) || Promise.resolve())
    .catch(() => {})
    .then(() =>
      window.research!.savePdfAnnotations(projectId, url, annotations, pages),
    );
  queuedSaves.set(key, next);
  void next
    .finally(() => {
      if (queuedSaves.get(key) === next) queuedSaves.delete(key);
    })
    .catch(() => {});
  return next;
}
function annotation(
  kind: PdfAnnotation["kind"],
  page: number,
  color: AnnotationColor,
): PdfAnnotation {
  return {
    id: crypto.randomUUID(),
    kind,
    page,
    color,
    comment: "",
    quote: "",
    createdAt: new Date().toISOString(),
  };
}
function screenPoint(viewport: PageViewport, point: PdfPoint) {
  return viewport.convertToViewportPoint(point.x, point.y);
}

const PdfPage = memo(function PdfPage({
  document,
  number,
  width,
  defaultRatio,
  tool,
  color,
  annotations,
  selectedId,
  add,
  select,
  report,
}: {
  document: PDFDocumentProxy;
  number: number;
  width: number;
  defaultRatio: number;
  tool: Tool;
  color: AnnotationColor;
  annotations: PdfAnnotation[];
  selectedId: string;
  add(item: PdfAnnotation): void;
  select(id: string): void;
  report(message: string): void;
}) {
  const element = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [near, setNear] = useState(false),
    [rendered, setRendered] = useState(false);
  const [draft, setDraft] = useState<PdfPoint[]>([]);
  const stroke = useRef<PdfPoint[] | null>(null);
  const [pageError, setPageError] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: element.current?.closest(".pdf-scroll"), rootMargin: "700px" },
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (near && !page)
      document
        .getPage(number)
        .then((value) => {
          if (!cancelled) setPage(value);
        })
        .catch((error: Error) => {
          if (!cancelled) setPageError(error.message);
        });
    return () => {
      cancelled = true;
    };
  }, [near, document, number, page]);
  const viewport = useMemo(
    () =>
      page?.getViewport({
        scale: width / page.getViewport({ scale: 1 }).width,
      }),
    [page, width],
  );
  useEffect(() => {
    if (!near || !page || !viewport || !canvas.current || !text.current) return;
    let cancelled = false;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const target = canvas.current;
    setRendered(false);
    setPageError("");
    target.width = Math.ceil(viewport.width * density);
    target.height = Math.ceil(viewport.height * density);
    const context = target.getContext("2d")!;
    const render: RenderTask = page.render({
      canvas: target,
      canvasContext: context,
      viewport,
      transform: [density, 0, 0, density, 0, 0],
    });
    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: text.current,
      viewport,
    });
    text.current.replaceChildren();
    Promise.all([render.promise, layer.render()])
      .then(() => {
        if (!cancelled) setRendered(true);
      })
      .catch((error: Error) => {
        if (
          !cancelled &&
          error.name !== "RenderingCancelledException" &&
          error.name !== "AbortException"
        )
          setPageError(error.message);
      });
    return () => {
      cancelled = true;
      render.cancel();
      layer.cancel();
    };
  }, [near, page, viewport]);
  const toPdf = (event: PointerEvent) => {
    const box = element.current!.getBoundingClientRect();
    const [x, y] = viewport!.convertToPdfPoint(
      Math.max(0, Math.min(box.width, event.clientX - box.left)),
      Math.max(0, Math.min(box.height, event.clientY - box.top)),
    );
    return { x, y };
  };
  const endStroke = (event: PointerEvent) => {
    if (!stroke.current || !viewport) return;
    const points = stroke.current;
    stroke.current = null;
    setDraft([]);
    if (element.current?.hasPointerCapture(event.pointerId))
      element.current.releasePointerCapture(event.pointerId);
    if (points.length > 1) add({ ...annotation("ink", number, color), points });
  };
  return (
    <div
      ref={element}
      className={`pdf-page tool-${tool}`}
      data-page-number={number}
      data-rendered={rendered}
      style={
        {
          width,
          height: viewport?.height || width * defaultRatio,
          "--total-scale-factor": viewport?.scale || 1,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as CSSProperties
      }
      onPointerDown={(event) => {
        if (
          !viewport ||
          !rendered ||
          event.button !== 0 ||
          (event.target as HTMLElement).closest(".pdf-note-pin")
        )
          return;
        if (tool === "note") {
          event.preventDefault();
          add({ ...annotation("note", number, color), position: toPdf(event) });
        }
        if (tool === "ink") {
          event.preventDefault();
          element.current!.setPointerCapture(event.pointerId);
          stroke.current = [toPdf(event)];
          setDraft(stroke.current);
        }
      }}
      onPointerMove={(event) => {
        if (stroke.current && viewport && stroke.current.length < 4000) {
          stroke.current.push(toPdf(event));
          setDraft([...stroke.current]);
        }
      }}
      onPointerUp={(event) => {
        if (tool === "ink") {
          endStroke(event);
          return;
        }
        if (tool !== "highlight" || !viewport || !rendered) return;
        const selection = window.getSelection();
        if (
          !selection ||
          selection.isCollapsed ||
          !selection.rangeCount ||
          !selection.toString().trim()
        )
          return;
        if (
          !text.current?.contains(selection.anchorNode) ||
          !text.current.contains(selection.focusNode)
        ) {
          report("Select text within one page to highlight it.");
          return;
        }
        const box = element.current!.getBoundingClientRect();
        const rects = Array.from(selection.getRangeAt(0).getClientRects())
          .filter(
            (r) =>
              r.width > 1 &&
              r.height > 1 &&
              r.left >= box.left - 1 &&
              r.right <= box.right + 1 &&
              r.top >= box.top - 1 &&
              r.bottom <= box.bottom + 1,
          )
          .map((r) => {
            const a = viewport.convertToPdfPoint(
                r.left - box.left,
                r.top - box.top,
              ),
              b = viewport.convertToPdfPoint(
                r.right - box.left,
                r.bottom - box.top,
              );
            return {
              x: Math.min(a[0], b[0]),
              y: Math.min(a[1], b[1]),
              width: Math.abs(b[0] - a[0]),
              height: Math.abs(b[1] - a[1]),
            };
          })
          .filter(
            (r, index, all) =>
              all.findIndex(
                (other) =>
                  Math.abs(other.x - r.x) < 0.5 &&
                  Math.abs(other.y - r.y) < 0.5 &&
                  Math.abs(other.width - r.width) < 0.5,
              ) === index,
          );
        if (rects.length)
          add({
            ...annotation("highlight", number, color),
            quote: selection.toString().slice(0, 4000),
            rects: rects.slice(0, 300),
          });
        selection.removeAllRanges();
      }}
      onPointerCancel={() => {
        stroke.current = null;
        setDraft([]);
      }}
    >
      <canvas
        ref={canvas}
        aria-label={`PDF page ${number}`}
        style={{ width, height: viewport?.height || width * defaultRatio }}
      />
      <div ref={text} className="textLayer" />
      {viewport && (
        <svg
          className="pdf-mark-layer"
          width={viewport.width}
          height={viewport.height}
          aria-hidden="true"
        >
          {annotations
            .filter((a) => a.page === number)
            .map((item) =>
              item.kind === "highlight" ? (
                <g key={item.id}>
                  {item.rects!.map((r, i) => {
                    const converted = viewport.convertToViewportRectangle([
                      r.x,
                      r.y,
                      r.x + r.width,
                      r.y + r.height,
                    ]);
                    return (
                      <rect
                        key={i}
                        x={Math.min(converted[0], converted[2])}
                        y={Math.min(converted[1], converted[3])}
                        width={Math.abs(converted[2] - converted[0])}
                        height={Math.abs(converted[3] - converted[1])}
                        fill={colors[item.color]}
                        opacity={0.3}
                        stroke={
                          selectedId === item.id ? colors[item.color] : "none"
                        }
                        strokeWidth={1}
                      />
                    );
                  })}
                </g>
              ) : item.kind === "ink" ? (
                <polyline
                  key={item.id}
                  points={item
                    .points!.map((point) =>
                      screenPoint(viewport, point).join(","),
                    )
                    .join(" ")}
                  stroke={colors[item.color]}
                  strokeWidth={Math.max(1.4, viewport.scale * 1.5)}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null,
            )}
          {!!draft.length && (
            <polyline
              points={draft
                .map((point) => screenPoint(viewport, point).join(","))
                .join(" ")}
              stroke={colors[color]}
              strokeWidth={Math.max(1.4, viewport.scale * 1.5)}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
      {viewport &&
        annotations
          .filter((a) => a.page === number && a.kind === "note")
          .map((item) => {
            const [x, y] = screenPoint(viewport, item.position!);
            return (
              <button
                key={item.id}
                className={`pdf-note-pin ${selectedId === item.id ? "selected" : ""}`}
                style={
                  {
                    left: Math.min(viewport.width - 24, Math.max(0, x)),
                    top: Math.min(viewport.height - 24, Math.max(0, y)),
                    "--mark-color": colors[item.color],
                  } as CSSProperties
                }
                title={item.comment || "PDF note"}
                aria-label={`Open note on page ${number}`}
                onClick={(event) => {
                  event.stopPropagation();
                  select(item.id);
                }}
              >
                <MessageSquare size={12} />
              </button>
            );
          })}
      {!rendered && (
        <div className="pdf-page-loading">{pageError || `Page ${number}`}</div>
      )}
      <span className="pdf-page-number">{number}</span>
    </div>
  );
});

export default function PdfReader({
  projectId,
  pdf,
  openPdf,
}: {
  projectId: string;
  pdf: { url: string; name: string };
  openPdf(pdf: { url: string; name: string }): void;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [items, setItems] = useState<PdfAnnotation[]>([]);
  const [tool, setTool] = useState<Tool>("select"),
    [color, setColor] = useState<AnnotationColor>("yellow");
  const [selectedId, setSelectedId] = useState(""),
    [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [savedAt, setSavedAt] = useState("");
  const [exporting, setExporting] = useState(false),
    [exported, setExported] = useState(false);
  const [versions, setVersions] = useState<PdfVersion[]>([]),
    [showVersions, setShowVersions] = useState(false),
    [documentKey, setDocumentKey] = useState("");
  const [pageNumber, setPageNumber] = useState(1),
    [pageInput, setPageInput] = useState("1");
  const [availableWidth, setAvailableWidth] = useState(400),
    [zoom, setZoom] = useState(1),
    [pageRatio, setPageRatio] = useState(1.414);
  const [filter, setFilter] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const pending = useRef<{ items: PdfAnnotation[]; pages: number } | null>(
    null,
  );
  const history = useRef<PdfAnnotation[][]>([]);
  const current = useRef<PdfAnnotation[]>([]);
  const mounted = useRef(true);
  const pageCount = document?.numPages || 0;
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const loading = window
      .research!.readPdfAnnotations(projectId, pdf.url)
      .then(async (data) => {
        if (cancelled) return;
        setDocumentKey(data.key);
        setItems(data.annotations);
        current.current = data.annotations;
        setSavedAt(data.updatedAt);
        const task = getDocument({
          data: new Uint8Array(data.data),
          isEvalSupported: false,
          useSystemFonts: true,
        });
        try {
          const loaded = await task.promise;
          if (cancelled) {
            await loaded.destroy();
            return;
          }
          const first = await loaded.getPage(1),
            size = first.getViewport({ scale: 1 });
          setPageRatio(size.height / size.width);
          setDocument(loaded);
        } catch (error) {
          if (!cancelled) setError((error as Error).message);
        }
        return task;
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      if (pending.current)
        void queueSave(
          projectId,
          pdf.url,
          pending.current.items,
          pending.current.pages,
        ).catch(() => {});
      void loading.then((task) => task?.destroy());
    };
  }, [projectId, pdf.url]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(Math.max(180, entry.contentRect.width - 32)),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [document, showNotes]);
  const persist = useCallback(async () => {
    const value = pending.current;
    if (!value) return;
    setSaving(true);
    try {
      const saved = await queueSave(
        projectId,
        pdf.url,
        value.items,
        value.pages,
      );
      if (mounted.current) {
        if (pending.current === value) pending.current = null;
        setSavedAt(saved.updatedAt);
      }
    } catch (error) {
      if (mounted.current)
        setError(`Annotations were not saved: ${(error as Error).message}`);
      throw error;
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [projectId, pdf.url]);
  useEffect(() => {
    if (!pending.current) return;
    void persist().catch(() => {});
  }, [items, persist]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".pdf-reader")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        void persist().catch(() => {});
      }
      if (event.key === "Escape") setTool("select");
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [persist]);
  const update = useCallback(
    (next: PdfAnnotation[], undoable = true) => {
      if (undoable) {
        history.current.push(current.current);
        if (history.current.length > 50) history.current.shift();
      }
      current.current = next;
      pending.current = { items: next, pages: pageCount };
      setItems(next);
      setError("");
      setExported(false);
    },
    [pageCount],
  );
  const add = useCallback(
    (item: PdfAnnotation) => {
      update([...current.current, item]);
      setSelectedId(item.id);
      if (item.kind === "note") {
        setShowNotes(true);
        setTool("select");
      }
    },
    [update],
  );
  const select = useCallback((id: string) => {
    setSelectedId(id);
    setShowNotes(true);
  }, []);
  const goTo = useCallback(
    (number: number) => {
      const value = Math.max(1, Math.min(pageCount, number));
      viewport.current
        ?.querySelector<HTMLElement>(`[data-page-number="${value}"]`)
        ?.scrollIntoView({ block: "start" });
      setPageNumber(value);
      setPageInput(String(value));
    },
    [pageCount],
  );
  const active = items.find((item) => item.id === selectedId);
  const matching = items.filter((item) =>
    `${item.comment} ${item.quote} ${item.page}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const width = Math.round(availableWidth * zoom);
  const help = {
    select: "Select text to copy. Choose a tool to annotate.",
    highlight: "Drag across text to highlight it.",
    note: "Click a page to place a note.",
    ink: "Drag on a page to draw. Esc returns to selection.",
  }[tool];
  return (
    <div
      className="pdf-reader"
      data-pdf-url={pdf.url}
      aria-label="PDF preview"
      role="region"
      tabIndex={0}
    >
      <div className="pdf-navigation">
        <button
          className="icon-button"
          title="Previous PDF page"
          disabled={!document || pageNumber === 1}
          onClick={() => goTo(pageNumber - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(pageInput);
            if (Number.isFinite(value)) goTo(value);
          }}
        >
          <input
            aria-label="PDF page number"
            inputMode="numeric"
            value={pageInput}
            disabled={!document}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={() => setPageInput(String(pageNumber))}
          />
          <span>/ {pageCount || "…"}</span>
        </form>
        <button
          className="icon-button"
          title="Next PDF page"
          disabled={!document || pageNumber === pageCount}
          onClick={() => goTo(pageNumber + 1)}
        >
          <ChevronRight size={14} />
        </button>
        <span className="pdf-toolbar-divider" />
        <button
          className="icon-button"
          title="Zoom out PDF"
          disabled={zoom <= 0.6}
          onClick={() => setZoom((value) => Math.max(0.6, value - 0.15))}
        >
          <ZoomOut size={14} />
        </button>
        <button
          className="pdf-fit"
          title="Fit PDF to width"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="icon-button"
          title="Zoom in PDF"
          disabled={zoom >= 2.5}
          onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))}
        >
          <ZoomIn size={14} />
        </button>
        <button
          className={`icon-button pdf-notes-toggle ${showNotes ? "active" : ""}`}
          title="Show PDF annotations"
          aria-pressed={showNotes}
          onClick={() => setShowNotes((value) => !value)}
        >
          <NotebookPen size={14} />
          {!!items.length && <small>{items.length}</small>}
        </button>
      </div>
      <div
        className="pdf-annotation-toolbar"
        role="toolbar"
        aria-label="PDF annotation tools"
      >
        {(
          [
            ["select", MousePointer2, "Select text"],
            ["highlight", Highlighter, "Highlight text"],
            ["note", MessageSquare, "Add PDF note"],
            ["ink", Pencil, "Draw on PDF"],
          ] as const
        ).map(([name, Icon, label]) => (
          <button
            key={name}
            className={`icon-button ${tool === name ? "active" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={tool === name}
            disabled={!document}
            onClick={() => setTool(name)}
          >
            <Icon size={15} />
          </button>
        ))}
        <span className="pdf-toolbar-divider" />
        {(Object.keys(colors) as AnnotationColor[]).map((name) => (
          <button
            key={name}
            title={`${name} annotation color`}
            aria-label={`${name} annotation color`}
            aria-pressed={color === name}
            className={`pdf-color ${color === name ? "active" : ""}`}
            style={{ "--mark-color": colors[name] } as CSSProperties}
            onClick={() => setColor(name)}
          >
            <span />
          </button>
        ))}
        <button
          className="icon-button pdf-undo"
          title="Undo PDF annotation"
          disabled={!history.current.length}
          onClick={() => {
            const previous = history.current.pop();
            if (previous) update(previous, false);
          }}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="icon-button"
          title="Annotated PDF versions"
          aria-expanded={showVersions}
          onClick={async () => {
            try {
              await persist();
              setVersions(
                await window.research!.pdfAnnotationLibrary(projectId),
              );
              setShowVersions((value) => !value);
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          <History size={14} />
          <ChevronDown size={10} />
        </button>
        <button
          className="icon-button"
          title="Export annotated PDF"
          disabled={!document || exporting}
          onClick={async () => {
            setExporting(true);
            setError("");
            try {
              await persist();
              setExported(
                await window.research!.exportAnnotatedPdf(
                  projectId,
                  pdf.url,
                  current.current,
                  pageCount,
                ),
              );
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <ArrowDownToLine size={14} />
          )}
        </button>
      </div>
      {showVersions && (
        <div className="pdf-versions">
          <div>
            <strong>Annotated documents</strong>
            <button
              className="icon-button"
              title="Close annotated documents"
              onClick={() => setShowVersions(false)}
            >
              <X size={13} />
            </button>
          </div>
          <p>Each version keeps its own annotations.</p>
          {versions.length ? (
            versions.map((version) => (
              <button
                key={version.key}
                disabled={version.key === documentKey}
                onClick={async () => {
                  try {
                    await persist();
                    openPdf(
                      await window.research!.openAnnotatedPdf(
                        projectId,
                        version.key,
                      ),
                    );
                  } catch (error) {
                    setError((error as Error).message);
                  }
                }}
              >
                <FileVersion name={version.name} />
                <span>
                  {new Date(version.updatedAt).toLocaleString()} ·{" "}
                  {version.count} annotations
                </span>
                {version.key === documentKey && <Check size={13} />}
              </button>
            ))
          ) : (
            <p>Documents appear here after the first annotation.</p>
          )}
        </div>
      )}
      {error && (
        <div className="pdf-reader-error" role="alert">
          {error}
          {pending.current && (
            <button onClick={() => void persist().catch(() => {})}>
              Retry save
            </button>
          )}
        </div>
      )}
      <div className={`pdf-reading-area ${showNotes ? "with-notes" : ""}`}>
        <div
          className="pdf-scroll"
          ref={viewport}
          onScroll={() => {
            if (!viewport.current) return;
            const top = viewport.current.getBoundingClientRect().top;
            const pages = Array.from(
              viewport.current.querySelectorAll<HTMLElement>(".pdf-page"),
            );
            const visible = pages.find(
              (element) => element.getBoundingClientRect().bottom > top + 40,
            );
            if (visible) {
              const number = Number(visible.dataset.pageNumber);
              setPageNumber(number);
              setPageInput(String(number));
            }
          }}
        >
          {document ? (
            Array.from({ length: pageCount }, (_, index) => (
              <PdfPage
                key={index + 1}
                document={document}
                number={index + 1}
                width={width}
                defaultRatio={pageRatio}
                tool={tool}
                color={color}
                annotations={items}
                selectedId={selectedId}
                add={add}
                select={select}
                report={setError}
              />
            ))
          ) : (
            <div className="pdf-reader-loading">
              <LoaderCircle size={22} className="spin" />
              <span>{error ? "PDF could not be opened" : "Opening PDF…"}</span>
            </div>
          )}
        </div>
        {showNotes && (
          <aside className="pdf-notes">
            <header>
              <strong>
                Annotations <small>{items.length}</small>
              </strong>
              <button
                className="icon-button"
                title="Close PDF annotations"
                onClick={() => setShowNotes(false)}
              >
                <X size={14} />
              </button>
            </header>
            <input
              aria-label="Search PDF annotations"
              placeholder="Search notes and highlights"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {matching.length ? (
              matching.map((item) => (
                <button
                  key={item.id}
                  className={`pdf-note-row ${selectedId === item.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedId(item.id);
                    goTo(item.page);
                  }}
                >
                  <span>
                    <i style={{ background: colors[item.color] }} />
                    {item.kind === "highlight"
                      ? "Highlight"
                      : item.kind === "note"
                        ? "Note"
                        : "Drawing"}
                    <small>p. {item.page}</small>
                  </span>
                  {item.quote && <q>{item.quote}</q>}
                  {item.comment && <p>{item.comment}</p>}
                </button>
              ))
            ) : (
              <p className="pdf-notes-empty">
                {filter
                  ? "No annotations match your search."
                  : "Highlights, notes and drawings appear here."}
              </p>
            )}
            {active && (
              <div className="pdf-note-editor">
                <label>
                  Annotation comment
                  <textarea
                    key={active.id}
                    autoFocus={active.kind === "note"}
                    aria-label="Annotation comment"
                    rows={4}
                    maxLength={8000}
                    placeholder="Write your comment…"
                    value={active.comment}
                    onChange={(event) =>
                      update(
                        current.current.map((item) =>
                          item.id === active.id
                            ? { ...item, comment: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  className="button text small"
                  onClick={() => {
                    update(
                      current.current.filter((item) => item.id !== active.id),
                    );
                    setSelectedId("");
                  }}
                >
                  <Trash2 size={12} />
                  Delete annotation
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
      <footer className="pdf-reader-status">
        <span>
          {saving ? (
            <>
              <LoaderCircle size={11} className="spin" />
              Saving annotations…
            </>
          ) : pending.current ? (
            "Unsaved annotations"
          ) : savedAt ? (
            <>
              <Check size={11} />
              Annotations saved
            </>
          ) : (
            "Annotations save automatically"
          )}
        </span>
        <span title={help}>{exported ? "Annotated PDF exported" : help}</span>
      </footer>
    </div>
  );
}
function FileVersion({ name }: { name: string }) {
  return <strong title={name}>{name}</strong>;
}
