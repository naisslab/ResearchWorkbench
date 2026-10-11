import { useWorkbenchVisible } from "./WorkbenchVisibility";
import { planAnnotationMigration } from "./pdf-migration";
import type { AIContext } from "./types";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  getDocument,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/display_utils";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Highlighter,
  History,
  LoaderCircle,
  Maximize2,
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
  AgentReplies,
  AnnotationColor,
  PdfAnnotation,
  PdfPoint,
  PdfTarget,
  PdfVersion,
  PdfView,
} from "./pdf-types";
import { timeLabel } from "./dates";
import {
  indexPdfText,
  matchingRects,
  normalizePdfText,
} from "../electron/pdf-text.mjs";
import type { TextRect } from "../electron/pdf-text.mjs";

import { loadPdfWorker as loadWorker } from "./pdf-worker";
const colors: Record<AnnotationColor, string> = {
  yellow: "#eabf3d",
  green: "#4dad6e",
  blue: "#4d94db",
  rose: "#d6668d",
};
type Tool = "select" | "source" | "highlight" | "note" | "ink";
type Flash = PdfTarget & { nonce: number; query?: string };
/** Keeps a reading spot fixed while pages resize: `offset` (a fraction of `page`) sits `y` px below the scroller top. */
type Anchor = { page: number; offset: number; y: number };
const none: PdfAnnotation[] = [];
const clampZoom = (zoom: number) => Math.min(2.5, Math.max(0.6, zoom));
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
function Ink({
  points,
  color,
  viewport,
}: {
  points: PdfPoint[];
  color: AnnotationColor;
  viewport: PageViewport;
}) {
  return (
    <polyline
      points={points
        .map((point) => screenPoint(viewport, point).join(","))
        .join(" ")}
      stroke={colors[color]}
      strokeWidth={Math.max(1.4, viewport.scale * 1.5)}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const PdfPage = memo(function PdfPage({
  document,
  number,
  activePage,
  width,
  defaultRatio,
  tool,
  color,
  annotations,
  selectedId,
  flash,
  add,
  select,
  searchSource,
  report,
}: {
  document: PDFDocumentProxy;
  number: number;
  activePage: number;
  width: number;
  defaultRatio: number;
  tool: Tool;
  color: AnnotationColor;
  annotations: PdfAnnotation[];
  selectedId: string;
  flash?: Flash;
  add(item: PdfAnnotation): void;
  select(id: string): void;
  searchSource(target: PdfTarget): void;
  report(message: string): void;
}) {
  const element = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    textBuilt = useRef(false),
    flashed = useRef<number | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [observedNear, setNear] = useState(false);
  // Intersection reports may lag a panel resize. Always render the active
  // reading page and its neighbors while retaining lazy rendering elsewhere.
  const near = observedNear || Math.abs(number - activePage) <= 1;
  // The viewport the canvas bitmap was last drawn at. Until it matches, CSS stretches the old bitmap.
  const [sharp, setSharp] = useState<PageViewport>();
  const [draft, setDraft] = useState<PdfPoint[]>([]);
  const stroke = useRef<PdfPoint[] | null>(null);
  const [pageError, setPageError] = useState("");
  const [searchRects, setSearchRects] = useState<TextRect[]>([]);
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
  const rendered = !!viewport && sharp === viewport;
  useEffect(() => {
    const container = text.current;
    if (!near || !page || !container || textBuilt.current) return;
    container.replaceChildren();
    // Built once: pdf.js sizes the layer from --total-scale-factor, so CSS keeps it aligned at any width.
    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport: page.getViewport({ scale: 1 }),
    });
    layer.render().then(
      () => {
        textBuilt.current = true;
      },
      () => {},
    );
    return () => layer.cancel();
  }, [near, page]);
  useEffect(() => {
    setSearchRects([]);
    if (!page || !flash?.query) return;
    let cancelled = false;
    const query = normalizePdfText(flash.query);
    if (!query) return;
    void page
      .getTextContent()
      .then((content) => {
        const { text, spans } = indexPdfText(content.items);
        const rects: TextRect[] = [];
        let from = 0,
          at;
        while ((at = text.indexOf(query, from)) >= 0 && rects.length < 2000) {
          rects.push(...matchingRects(spans, at, query.length));
          from = at + query.length;
        }
        if (!cancelled) setSearchRects(rects);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [page, flash?.nonce, flash?.query]);
  useEffect(() => {
    if (!near || !page || !viewport || sharp === viewport) return;
    let cancelled = false,
      render: RenderTask | undefined;
    // The first paint is immediate; repaints wait until a drag or zoom settles.
    const timer = setTimeout(
      () => {
        const density = Math.min(window.devicePixelRatio || 1, 2);
        const scratch = window.document.createElement("canvas");
        scratch.width = Math.ceil(viewport.width * density);
        scratch.height = Math.ceil(viewport.height * density);
        render = page.render({
          canvas: scratch,
          viewport,
          transform: [density, 0, 0, density, 0, 0],
        });
        render.promise.then(
          () => {
            const target = canvas.current;
            if (cancelled || !target) return;
            target.width = scratch.width;
            target.height = scratch.height;
            target.getContext("2d")!.drawImage(scratch, 0, 0);
            setSharp(viewport);
            setPageError("");
          },
          (error: Error) => {
            if (!cancelled) setPageError(error.message);
          },
        );
      },
      sharp ? 120 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      render?.cancel();
    };
  }, [near, page, viewport, sharp]);
  // A page far from view gives back its bitmap and pdf.js render data, so a
  // long thesis keeps only the pages around the viewport in memory.
  useEffect(() => {
    if (near || !page) return;
    const target = canvas.current;
    if (target) target.width = target.height = 0;
    setSharp(undefined);
    page.cleanup();
  }, [near, page]);
  useEffect(() => {
    const box = element.current!;
    if (!flash || flashed.current === flash.nonce) return;
    // Bring the page near first; the exact scroll follows once its size is known.
    if (!viewport) return box.scrollIntoView({ block: "start" });
    flashed.current = flash.nonce;
    const scroller = box.closest(".pdf-scroll")!;
    scroller.scrollTop +=
      box.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      flash.y * viewport.scale -
      scroller.clientHeight / 3;
  }, [flash, viewport]);
  const toPdf = (event: PointerEvent) => {
    const box = element.current!.getBoundingClientRect();
    const [x, y] = viewport!.convertToPdfPoint(
      Math.max(0, Math.min(box.width, event.clientX - box.left)),
      Math.max(0, Math.min(box.height, event.clientY - box.top)),
    );
    return { x, y };
  };
  const showSource = (event: MouseEvent) => {
    if (
      !page ||
      !viewport ||
      !sharp ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".pdf-note-pin")
    )
      return;
    event.preventDefault();
    const box = element.current!.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(
      (event.clientX - box.left) * (viewport.width / box.width),
      (event.clientY - box.top) * (viewport.height / box.height),
    );
    // SyncTeX uses unrotated points from the top-left, while annotations use
    // PDF coordinates from the bottom-left. The viewport also handles zoom.
    searchSource({
      page: number,
      x: x - page.view[0],
      y: page.view[3] - y,
    });
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
      data-near={near}
      data-viewport-width={viewport?.width}
      data-sharp-width={sharp?.width}
      onClick={(event) => {
        if (
          event.detail <= 1 &&
          (tool === "source" || event.metaKey || event.ctrlKey)
        )
          showSource(event);
      }}
      onDoubleClick={(event) => {
        if (tool === "select" && !event.metaKey && !event.ctrlKey)
          showSource(event);
      }}
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
        // Input maps through the current viewport, so a stretched bitmap
        // waiting for its sharp repaint still takes strokes and notes.
        if (
          !viewport ||
          !sharp ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
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
        if (event.metaKey || event.ctrlKey) return;
        if (tool !== "highlight" || !viewport || !sharp) return;
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
      <canvas ref={canvas} aria-label={`PDF page ${number}`} />
      <div ref={text} className="textLayer" />
      {viewport && (
        <svg
          className="pdf-mark-layer"
          width={viewport.width}
          height={viewport.height}
          aria-hidden="true"
        >
          {searchRects.map((r, i) => {
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
              r.x,
              r.y,
              r.x + r.width,
              r.y + r.height,
            ]);
            return (
              <rect
                key={`search-${i}`}
                className="pdf-search-match"
                x={Math.min(x1, x2)}
                y={Math.min(y1, y2)}
                width={Math.abs(x2 - x1)}
                height={Math.abs(y2 - y1)}
                fill="#eabf3d"
                opacity={0.4}
              />
            );
          })}
          {annotations.map((item) =>
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
              <Ink
                key={item.id}
                points={item.points!}
                color={item.color}
                viewport={viewport}
              />
            ) : null,
          )}
          {!!draft.length && (
            <Ink points={draft} color={color} viewport={viewport} />
          )}
        </svg>
      )}
      {viewport &&
        annotations
          .filter((a) => a.kind === "note")
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
      {flash && viewport && (
        <span
          key={flash.nonce}
          className="pdf-flash"
          style={{ top: flash.y * viewport.scale }}
        />
      )}
      {(!sharp || pageError) && (
        <div className="pdf-page-loading">{pageError || `Page ${number}`}</div>
      )}
      <span className="pdf-page-number">{number}</span>
    </div>
  );
});

export default memo(function PdfReader({
  projectId,
  pdf,
  openPdf,
  onAskAgent,
  onDocumentKey,
  initialView,
  onViewChange,
  reveal,
  onInverseSearch,
  expanded,
  onExpand,
}: {
  projectId: string;
  pdf: { url: string; name: string };
  openPdf(pdf: { url: string; name: string }): void;
  onAskAgent(context: AIContext): void;
  onDocumentKey(key: string, archived: boolean): void;
  /** Applied once, after the first layout of the document. */
  initialView?: PdfView;
  onViewChange(view: PdfView): void;
  /** Scrolls to the target and flashes a marker there; a new `nonce` repeats it. */
  reveal?: Flash;
  onInverseSearch(target: PdfTarget): Promise<void>;
  expanded: boolean;
  onExpand(): void;
}) {
  const visible = useWorkbenchVisible();
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [items, setItems] = useState<PdfAnnotation[]>([]);
  const [tool, setTool] = useState<Tool>("select"),
    [color, setColor] = useState<AnnotationColor>("yellow");
  const [selectedId, setSelectedId] = useState(""),
    [showNotes, setShowNotes] = useState(initialView?.showNotes ?? false);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [savedAt, setSavedAt] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [searchingSource, setSearchingSource] = useState(false);
  const sourceSearch = useRef(false);
  const searchSource = useCallback(
    async (target: PdfTarget) => {
      if (sourceSearch.current) return;
      sourceSearch.current = true;
      setSearchingSource(true);
      setSourceError("");
      try {
        await onInverseSearch(target);
      } catch (error) {
        setSourceError((error as Error).message);
      } finally {
        sourceSearch.current = false;
        setSearchingSource(false);
        setSelectedText(undefined);
      }
    },
    [onInverseSearch],
  );
  const [migrating, setMigrating] = useState(false);
  const [migration, setMigration] = useState<{
    matched: PdfAnnotation[];
    unresolved: PdfAnnotation[];
  }>();
  async function previewMigration(key: string) {
    if (!document) return;
    setMigrating(true);
    try {
      await window.research!.readPdfAnnotations(projectId, pdf.url);
      const old = await window.research!.openAnnotatedPdf(projectId, key);
      const data = await window.research!.readPdfAnnotations(
        projectId,
        old.url,
      );
      setMigration(await planAnnotationMigration(document, data.annotations));
      setShowVersions(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setMigrating(false);
    }
  }
  const [exporting, setExporting] = useState(false),
    [exported, setExported] = useState(false);
  const [versions, setVersions] = useState<PdfVersion[]>([]),
    [showVersions, setShowVersions] = useState(false),
    [documentKey, setDocumentKey] = useState("");
  // What the agent says it changed for each annotation; only the user
  // resolves feedback.
  const [agentReplies, setAgentReplies] = useState<AgentReplies>({});
  useEffect(
    () =>
      window.research!.onAgentReplies((event) => {
        if (event.projectId === projectId && event.key === documentKey)
          setAgentReplies(event.replies);
      }),
    [projectId, documentKey],
  );
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedText, setSelectedText] = useState<{
    text: string;
    page: number;
    x: number;
    y: number;
  }>();
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const selection = () => {
      const value = window.getSelection();
      if (!value || value.isCollapsed || !value.rangeCount) return;
      const page =
        value.anchorNode?.parentElement?.closest<HTMLElement>(".pdf-page");
      if (
        !page ||
        !scroller.current?.contains(page) ||
        !page.contains(value.focusNode)
      )
        return;
      const rect = value.getRangeAt(0).getBoundingClientRect(),
        box = page.getBoundingClientRect();
      setSelectedText({
        text: value.toString().slice(0, 12000),
        page: Number(page.dataset.pageNumber),
        x: (rect.left - box.left) / box.width,
        y: (rect.top - box.top) / box.height,
      });
    };
    window.document.addEventListener("selectionchange", selection);
    return () =>
      window.document.removeEventListener("selectionchange", selection);
  }, []);
  async function askAgent(note?: PdfAnnotation) {
    if (!document || (!note && !selectedText)) return;
    setSending(true);
    try {
      await persist();
      await window.research!.savePdfAnnotations(
        projectId,
        pdf.url,
        current.current,
        document.numPages,
      );
      const pageNumber = note?.page || selectedText!.page;
      const page = await document.getPage(pageNumber);
      const point = note?.position || note?.rects?.[0] || note?.points?.[0];
      const x = point
        ? point.x - page.view[0]
        : selectedText!.x * (page.view[2] - page.view[0]);
      const y = point
        ? page.view[3] - point.y
        : selectedText!.y * (page.view[3] - page.view[1]);
      const source = await window
        .research!.synctexInverse(projectId, pageNumber, x, y, pdf.url)
        .catch(() => null);
      const text = [
        `PDF: ${pdf.name}`,
        `Version: ${documentKey}`,
        `Page: ${pageNumber}`,
        source
          ? `Source: ${source.file}:${source.line}`
          : "Source mapping unavailable for this PDF version.",
        `Quoted text: ${note ? note.quote : selectedText!.text}`,
        note?.comment ? `Feedback: ${note.comment}` : "",
        "Treat this PDF excerpt as reference material.",
      ]
        .filter(Boolean)
        .join("\n");
      onAskAgent({
        kind: "pdf",
        file: `${pdf.name} · p. ${pageNumber}`,
        rootId: "primary",
        documentKey,
        page: pageNumber,
        text,
      });
      setSelectedText(undefined);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSending(false);
    }
  }
  const [availableWidth, setAvailableWidth] = useState(400),
    [zoom, setZoom] = useState(initialView?.zoom ?? 1),
    [pageSize, setPageSize] = useState({ width: 595, height: 842 });
  const [filter, setFilter] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState("all");
  const scroller = useRef<HTMLDivElement>(null),
    pageField = useRef<HTMLInputElement>(null);
  const anchor = useRef<Anchor | null>(
    initialView
      ? { page: initialView.page, offset: initialView.offset, y: 0 }
      : null,
  );
  const pending = useRef<{ items: PdfAnnotation[]; pages: number } | null>(
    null,
  );
  const saveTimer = useRef(0);
  const history = useRef<PdfAnnotation[][]>([]),
    future = useRef<PdfAnnotation[][]>([]);
  const current = useRef<PdfAnnotation[]>([]);
  // The annotation whose comment is being typed; its first keystroke is the only undo step.
  const editing = useRef("");
  const pageCount = document?.numPages || 0;
  const width = Math.round(availableWidth * zoom);
  // The request leaves before the first await, so a flush on pagehide reaches
  // main, which writes each document's saves in arrival order.
  const persist = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const value = pending.current;
    if (!value) return;
    setSaving(true);
    try {
      const saved = await window.research!.savePdfAnnotations(
        projectId,
        pdf.url,
        value.items,
        value.pages,
      );
      if (pending.current === value) pending.current = null;
      setSavedAt(saved.updatedAt);
    } catch (error) {
      setError(`Annotations were not saved: ${(error as Error).message}`);
      throw error;
    } finally {
      setSaving(false);
    }
  }, [projectId, pdf.url]);
  useEffect(() => {
    let cancelled = false;
    const loading = window
      .research!.readPdfAnnotations(projectId, pdf.url)
      .then(async (data) => {
        await loadWorker();
        if (cancelled) return;
        setDocumentKey(data.key);
        setAgentReplies(data.agentReplies || {});
        setItems(data.annotations);
        current.current = data.annotations;
        setSavedAt(data.updatedAt);
        const task = getDocument({
          data: data.data,
          isEvalSupported: false,
          useSystemFonts: true,
        });
        try {
          const loaded = await task.promise;
          const size = (await loaded.getPage(1)).getViewport({ scale: 1 });
          // Other PDFs keep a copy for restarts and search; the compiled
          // manuscript is copied once it is annotated or sent to the agent.
          if (!data.updatedAt && !data.compiled && !cancelled)
            await window.research!.savePdfAnnotations(
              projectId,
              pdf.url,
              data.annotations,
              loaded.numPages,
            );
          if (!cancelled) onDocumentKey(data.key, !!data.archived);
          if (!cancelled) {
            setPageSize(size);
            setDocument(loaded);
          }
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
      void persist().catch(() => {});
      void loading.then((task) => task?.destroy());
    };
  }, [projectId, pdf.url, persist]);
  const locate = (y: number): Anchor | null => {
    if (!visible || !scroller.current?.clientHeight) return null;
    const element = scroller.current!,
      line = element.scrollTop + y;
    const pages = element.querySelectorAll<HTMLElement>(".pdf-page");
    // Pages are in order, so a binary search finds the first one that ends
    // below the line; every scroll event runs this.
    let low = 0,
      high = pages.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      const { offsetTop, offsetHeight } = pages[middle];
      if (offsetTop + offsetHeight > line + 40) high = middle;
      else low = middle + 1;
    }
    const page = pages[low];
    return page
      ? {
          page: Number(page.dataset.pageNumber),
          offset: (line - page.offsetTop) / page.offsetHeight,
          y,
        }
      : null;
  };
  const reportView = (at = locate(0)) => {
    if (at) onViewChange({ page: at.page, offset: at.offset, zoom, showNotes });
  };
  useEffect(() => {
    const element = scroller.current!;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setAvailableWidth(Math.max(180, entry.contentRect.width - 32));
    });
    // Trackpad pinches arrive as ctrl+wheel; both zoom around the pointer.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      anchor.current = locate(
        event.clientY - element.getBoundingClientRect().top,
      );
      setZoom((value) => clampZoom(value * Math.exp(-event.deltaY / 200)));
    };
    observer.observe(element);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current!,
      at = anchor.current,
      page =
        at &&
        element.querySelector<HTMLElement>(`[data-page-number="${at.page}"]`);
    if (!visible || !at || !page) return;
    element.scrollTop = page.offsetTop + at.offset * page.offsetHeight - at.y;
  }, [document, width, visible]);
  useEffect(() => reportView(), [zoom, showNotes]);
  useEffect(() => {
    if (
      pageField.current &&
      pageField.current !== window.document.activeElement
    )
      pageField.current.value = String(pageNumber);
  }, [pageNumber]);
  const update = useCallback(
    (next: PdfAnnotation[], undoable = true) => {
      if (undoable) {
        history.current.push(current.current);
        if (history.current.length > 50) history.current.shift();
        future.current = [];
      }
      current.current = next;
      pending.current = { items: next, pages: pageCount };
      setItems(next);
      setError("");
      setExported(false);
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(
        () => void persist().catch(() => {}),
        400,
      );
    },
    [pageCount, persist],
  );
  const undo = useCallback(
    (redo = false) => {
      const [from, to] = redo ? [future, history] : [history, future];
      const next = from.current.pop();
      if (!next) return;
      to.current.push(current.current);
      update(next, false);
    },
    [update],
  );
  useEffect(() => {
    const flush = () => void persist().catch(() => {});
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".pdf-reader")?.contains(scroller.current)) return;
      const command = event.metaKey || event.ctrlKey,
        key = event.key?.toLowerCase();
      if (command && key === "s") {
        event.preventDefault();
        event.stopPropagation();
        flush();
      } else if (
        command &&
        key === "z" &&
        !target.closest("input, textarea, [contenteditable]")
      ) {
        event.preventDefault();
        undo(event.shiftKey);
      } else if (event.key === "Escape") setTool("select");
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("pagehide", flush);
    };
  }, [persist, undo]);
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
  const goTo = (number: number) => {
    const value = Math.max(1, Math.min(pageCount, number));
    // Keep the explicit page target through an in-flight panel resize.
    anchor.current = { page: value, offset: 0, y: 0 };
    scroller.current
      ?.querySelector<HTMLElement>(`[data-page-number="${value}"]`)
      ?.scrollIntoView({ block: "start" });
    setPageNumber(value);
  };
  // Saves pending annotations first, so the action sees them.
  const run = async (task: () => Promise<unknown>) => {
    try {
      await persist();
      await task();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const open = (load: () => Promise<{ url: string; name: string } | null>) =>
    run(async () => {
      const next = await load();
      if (next) openPdf(next);
    });
  const byPage = useMemo(() => {
    const pages = new Map<number, PdfAnnotation[]>();
    for (const item of items)
      pages.set(item.page, [...(pages.get(item.page) ?? []), item]);
    return pages;
  }, [items]);
  const active = items.find((item) => item.id === selectedId);
  const matching = items.filter(
    (item) =>
      (feedbackFilter === "all" ||
        (feedbackFilter === "resolved" ? item.resolved : !item.resolved)) &&
      `${item.comment} ${item.quote} ${item.page}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const [saveLabel, saveTitle] = saving
    ? ["Saving…", "Saving annotations…"]
    : pending.current
      ? ["Unsaved", "Unsaved annotations"]
      : exported
        ? ["Exported", "Annotated PDF exported"]
        : savedAt
          ? ["Saved", "Annotations saved"]
          : [];
  return (
    <div
      className="pdf-reader"
      data-pdf-url={pdf.url}
      aria-label="PDF preview"
      role="region"
      tabIndex={0}
    >
      <div className="pdf-toolbar">
        <strong className="pdf-name" title={pdf.name}>
          {pdf.name}
        </strong>
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
            const value = Number(pageField.current!.value);
            if (Number.isFinite(value)) goTo(value);
          }}
        >
          <input
            ref={pageField}
            aria-label="PDF page number"
            inputMode="numeric"
            defaultValue="1"
            disabled={!document}
            onBlur={(event) => (event.currentTarget.value = String(pageNumber))}
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
          onClick={() => setZoom((value) => clampZoom(value - 0.15))}
        >
          <ZoomOut size={14} />
        </button>
        <button
          className="pdf-fit"
          title="Fit PDF to width"
          onClick={() => setZoom(1)}
        >
          {zoom === 1 && "Fit · "}
          {/* 100% is print size: one PDF point is 4/3 CSS px. */}
          {Math.round((width / pageSize.width) * 75)}%
        </button>
        <button
          className="icon-button"
          title="Zoom in PDF"
          disabled={zoom >= 2.5}
          onClick={() => setZoom((value) => clampZoom(value + 0.15))}
        >
          <ZoomIn size={14} />
        </button>
        <button
          className="button text small"
          title="Send PDF selection or annotation to Agent"
          disabled={sending || (!selectedText && !active)}
          onClick={() => void askAgent(selectedText ? undefined : active)}
        >
          {sending
            ? "Attaching…"
            : selectedText
              ? "Ask Agent about selection"
              : "Ask Agent"}
        </button>
        <div
          className="pdf-tools"
          role="toolbar"
          aria-label="PDF annotation tools"
        >
          {(
            [
              ["select", MousePointer2, "Select text"],
              ["source", Crosshair, "Jump to source"],
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
            className="icon-button"
            title="Undo PDF annotation"
            disabled={!history.current.length}
            onClick={() => undo()}
          >
            <RotateCcw size={14} />
          </button>
        </div>
        <span className="pdf-save-state" title={saveTitle}>
          {saving && <LoaderCircle size={11} className="spin" />}
          {saveLabel}
        </span>
        <button
          className="icon-button"
          title="Annotated PDF versions"
          aria-expanded={showVersions}
          onClick={() =>
            run(async () => {
              setVersions(
                await window.research!.pdfAnnotationLibrary(projectId),
              );
              setShowVersions((value) => !value);
            })
          }
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
            await run(async () =>
              setExported(
                await window.research!.exportAnnotatedPdf(
                  projectId,
                  pdf.url,
                  current.current,
                  pageCount,
                ),
              ),
            );
            setExporting(false);
          }}
        >
          {exporting ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <ArrowDownToLine size={14} />
          )}
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
        <button
          className="icon-button"
          title={expanded ? "Restore split view" : "Expand PDF preview"}
          onClick={onExpand}
        >
          <Maximize2 size={14} />
        </button>
        {showVersions && (
          <div className="pdf-versions">
            <div>
              <strong>Annotated documents</strong>
              <button
                className="button text small"
                onClick={() =>
                  open(() => window.research!.choosePdf(projectId))
                }
              >
                Open PDF
              </button>
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
                <div className="pdf-version-entry" key={version.key}>
                  <button
                    disabled={version.key === documentKey}
                    onClick={() =>
                      open(() =>
                        window.research!.openAnnotatedPdf(
                          projectId,
                          version.key,
                        ),
                      )
                    }
                  >
                    <strong title={version.name}>{version.name}</strong>
                    <span>
                      {timeLabel(version.updatedAt)} · {version.count}{" "}
                      annotations
                    </span>
                    {version.key === documentKey && <Check size={13} />}
                  </button>
                  {version.key !== documentKey && version.count > 0 && (
                    <button
                      className="button text small"
                      disabled={migrating || !document}
                      onClick={() => void previewMigration(version.key)}
                    >
                      {migrating
                        ? "Matching…"
                        : "Copy highlights to current PDF…"}
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p>Documents appear here after the first annotation.</p>
            )}
          </div>
        )}
      </div>
      {migration && (
        <div
          className="pdf-migration"
          role="region"
          aria-label="Review annotation transfer"
        >
          <strong>
            {migration.matched.length} uniquely matched highlights
          </strong>
          <p>
            {migration.unresolved.length} annotations could not be located
            reliably and will stay in the original version. Review the matched
            highlights before applying.
          </p>
          <ul>
            {migration.matched.map((item) => (
              <li key={item.id}>
                <button onClick={() => goTo(item.page)}>
                  Page {item.page}: {item.quote.slice(0, 90)}
                </button>
              </li>
            ))}
          </ul>
          <button
            className="button small"
            disabled={
              !migration.matched.length ||
              items.length + migration.matched.length > 1000
            }
            onClick={() => {
              update([...current.current, ...migration.matched]);
              setMigration(undefined);
              setShowNotes(true);
            }}
          >
            Copy matched highlights
          </button>
          <button
            className="button text small"
            onClick={() => setMigration(undefined)}
          >
            Cancel
          </button>
        </div>
      )}
      <div className="pdf-source-hint" role="status">
        {searchingSource ? (
          <>
            <LoaderCircle size={11} className="spin" /> Finding source…
          </>
        ) : tool === "source" ? (
          "Click a PDF location to open its source line · Esc to select text"
        ) : tool !== "select" ? (
          "⌘/Ctrl-click to jump to source · Esc to select text"
        ) : (
          "Double-click to jump to source · ⌘/Ctrl-click also works"
        )}
      </div>
      {sourceError && (
        <div className="pdf-reader-error" role="alert">
          {sourceError}
          <button
            aria-label="Dismiss source lookup error"
            onClick={() => setSourceError("")}
          >
            <X size={12} />
          </button>
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
          ref={scroller}
          onScroll={() => {
            const at = locate(0);
            if (!at) return;
            anchor.current = at;
            setPageNumber(at.page);
            reportView(at);
          }}
        >
          {document ? (
            Array.from({ length: pageCount }, (_, index) => (
              <PdfPage
                key={index + 1}
                document={document}
                number={index + 1}
                activePage={pageNumber}
                width={width}
                defaultRatio={pageSize.height / pageSize.width}
                tool={tool}
                color={color}
                annotations={byPage.get(index + 1) ?? none}
                selectedId={selectedId}
                flash={reveal?.page === index + 1 ? reveal : undefined}
                add={add}
                select={select}
                searchSource={searchSource}
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
                Annotations{" "}
                <small>
                  {items.filter((item) => !item.resolved).length} open /{" "}
                  {items.length}
                </small>
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
            <select
              aria-label="Filter PDF feedback"
              value={feedbackFilter}
              onChange={(event) => setFeedbackFilter(event.target.value)}
            >
              <option value="all">All feedback</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
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
                  <small className="pdf-feedback-state">
                    {item.resolved
                      ? "Resolved"
                      : agentReplies[item.id]
                        ? "Open · Agent replied"
                        : "Open"}
                  </small>
                  {item.quote && <q>{item.quote}</q>}
                  {item.comment && <p>{item.comment}</p>}
                </button>
              ))
            ) : (
              <p className="pdf-notes-empty">
                {filter || feedbackFilter !== "all"
                  ? "No annotations match this filter."
                  : "Highlights, notes and drawings appear here."}
              </p>
            )}
            {active && (
              <div className="pdf-note-editor">
                {agentReplies[active.id] && (
                  <p className="pdf-agent-reply">
                    <strong>Agent</strong> {agentReplies[active.id].note}
                  </p>
                )}
                <button
                  type="button"
                  className="button small"
                  onClick={() => {
                    update(
                      current.current.map((item) =>
                        item.id === active.id
                          ? { ...item, resolved: !item.resolved }
                          : item,
                      ),
                    );
                  }}
                >
                  {active.resolved ? "Reopen feedback" : "Mark resolved"}
                </button>
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
                    onChange={(event) => {
                      update(
                        current.current.map((item) =>
                          item.id === active.id
                            ? { ...item, comment: event.target.value }
                            : item,
                        ),
                        editing.current !== active.id,
                      );
                      editing.current = active.id;
                    }}
                    onBlur={() => {
                      editing.current = "";
                      void persist().catch(() => {});
                    }}
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
                <button
                  className="button small"
                  disabled={sending}
                  onClick={() => void askAgent(active)}
                >
                  Ask Agent to address this
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
});
