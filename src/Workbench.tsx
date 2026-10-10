import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { fileLanguage } from "./syntax";
import {
  citationKeys,
  countWords,
  forgetCitations,
  latexCompletion,
  outline,
  parseProblems,
} from "./latex";
import {
  Play,
  Save,
  Square,
  ChevronRight,
  Crosshair,
  FileText,
  FolderOpen,
  FolderPlus,
  TerminalSquare,
  FilePlus2,
  RefreshCw,
  PanelRightClose,
  PanelRightOpen,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Maximize2,
  PanelsTopLeft,
  Sparkles,
} from "lucide-react";
import type { Project, ProjectFileRoot } from "./types";
import GitPanel from "./GitPanel";
import PdfReader from "./PdfReader";
import ProjectFiles, { type FileAction } from "./ProjectFiles";
import TerminalPanel from "./TerminalPanel";
import AIPanel from "./AIPanel";
import { useDark } from "./theme";
import PanelDivider from "./PanelDivider";
import {
  defaultPanelLayout,
  fitWorkbench,
  fitBottomPanel,
  fitAgentColumns,
  fitThreeColumns,
  type PanelLayout,
} from "./panel-layout";
import { usePanelSize } from "./usePanelLayout";
import type { PdfTarget, PdfView } from "./pdf-types";
import BuildLog from "./BuildLog";
import Modal from "./Modal";
// Colours live in CSS: Lezer tags map onto the syn-* classes that the TextMate
// highlighter uses, and the editor chrome reads CSS variables.
const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.tagName], class: "syn-keyword" },
    { tag: [tags.string, tags.attributeValue], class: "syn-string" },
    { tag: tags.comment, class: "syn-comment" },
    { tag: tags.number, class: "syn-number" },
    { tag: [tags.bool, tags.null, tags.atom], class: "syn-constant" },
    { tag: [tags.typeName, tags.className], class: "syn-type" },
    {
      tag: [tags.propertyName, tags.variableName, tags.attributeName],
      class: "syn-variable",
    },
    { tag: tags.function(tags.variableName), class: "syn-function" },
    { tag: tags.heading, class: "syn-heading" },
    { tag: [tags.bracket, tags.punctuation], class: "syn-punctuation" },
    { tag: tags.operator, class: "syn-operator" },
    { tag: tags.invalid, class: "syn-invalid" },
  ]),
);
const syntaxColors = Object.fromEntries(
  [
    "keyword",
    "function",
    "string",
    "reference",
    "variable",
    "number",
    "constant",
    "heading",
    "type",
    "math",
    "operator",
    "delimiter",
    "punctuation",
  ].map((name) => [`.syn-${name}`, { color: `var(--syn-${name})` }]),
);
const editorTheme = (dark: boolean) =>
  EditorView.theme(
    {
      "&": {
        color: "var(--editor-fg)",
        backgroundColor: "var(--editor-bg)",
        fontSize: "var(--text-sm)",
      },
      ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: 1.6 },
      ".cm-content": { caretColor: "var(--editor-caret)", padding: "10px 0" },
      ".cm-line": { paddingLeft: "14px" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--editor-caret)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "var(--editor-selection)" },
      ".cm-gutters": {
        color: "var(--editor-gutter-fg)",
        backgroundColor: "var(--editor-bg)",
        border: "none",
        fontSize: "var(--text-xs)",
      },
      ".cm-foldGutter": { width: "14px" },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "var(--editor-active-line)",
      },
      ".cm-activeLineGutter": { color: "var(--text-secondary)" },
      ".cm-matchingBracket": { backgroundColor: "var(--editor-bracket)" },
      ...syntaxColors,
      ".syn-comment": { color: "var(--syn-comment)", fontStyle: "italic" },
      ".syn-invalid": { textDecoration: "underline wavy var(--syn-invalid)" },
    },
    { dark },
  );
const lightEditor = editorTheme(false);
const darkEditor = editorTheme(true);
/** Last file and cursor per project, and each PDF's position by name, kept while the app runs. */
const sessions = new Map<
  string,
  {
    rootId?: string;
    file?: string;
    anchor?: number;
    head?: number;
    pdfs: Record<string, PdfView>;
  }
>();
/** A callback with a stable identity that runs the latest render's code. */
function useStableCallback<A extends unknown[], R>(
  callback: (...args: A) => R,
) {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback((...args: A) => latest.current(...args), []);
}
type BottomTab = "terminal" | "ai" | "build";
function Workbench({
  project,
  update,
  report,
  clearError,
  onStatus,
  layout,
  changeLayout,
}: {
  project: Project;
  update(changes: Partial<Project>): Promise<void>;
  report(message: string, source?: string): void;
  clearError(source: string): void;
  onStatus(status: { file: string; dirty: boolean }): void;
  layout: PanelLayout;
  changeLayout(changes: Partial<PanelLayout>): void;
}) {
  const [panesRef, panesSize] = usePanelSize();
  const [workbenchRef, workbenchSize] = usePanelSize();
  const dark = useDark();
  const [session] = useState(
    () =>
      sessions.get(project.id) ??
      sessions.set(project.id, { pdfs: {} }).get(project.id)!,
  );
  const [roots, setRoots] = useState<ProjectFileRoot[]>([]);
  const [fileRevision, setFileRevision] = useState(0);
  const [activeRoot, setActiveRoot] = useState("primary");
  const [folderModal, setFolderModal] = useState(false);
  const [folderLabel, setFolderLabel] = useState("Code");
  const [active, setActive] = useState("");
  const [support, setSupport] = useState<Extension>([]);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // undefined until the last PDF has been looked up.
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>();
  const [reveal, setReveal] = useState<
    PdfTarget & { nonce: number; url: string }
  >();
  const [showPdf, setShowPdf] = useState(true);
  const agentMode = layout.workMode === "agent";
  const columnsMode = layout.workMode === "columns";
  const sideTools = agentMode || columnsMode;
  const showTerminal = layout.bottomOpen;
  const bottomTab = layout.bottomTab as BottomTab;
  const showTab = (tab: BottomTab) =>
    changeLayout({ bottomOpen: true, bottomTab: tab });
  const [prompt, setPrompt] = useState<(() => void) | null>(null);
  const [diskConflict, setDiskConflict] = useState(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [localTerminalRequest, setLocalTerminalRequest] = useState(0);
  const [agentRunning, setAgentRunning] = useState(false);
  const [selection, setSelection] = useState("");
  const [log, setLog] = useState("");
  const [buildState, setBuildState] = useState<"idle" | "ok" | "error">("idle");
  // The root a new file goes in, while the dialog is open.
  const [newFile, setNewFile] = useState<string>();
  const [filename, setFilename] = useState("section.tex");
  const [renaming, setRenaming] = useState<{
    rootId: string;
    path: string;
    to: string;
  }>();
  const [trashing, setTrashing] = useState<{ rootId: string; path: string }>();
  const [expandedPdf, setExpandedPdf] = useState(false);
  const [expandedAI, setExpandedAI] = useState(false);
  const aiFocused = expandedAI && bottomTab === "ai" && showTerminal;
  function switchMode(workMode: PanelLayout["workMode"]) {
    changeLayout({
      workMode,
      bottomOpen: workMode !== "edit",
      bottomTab: "ai",
    });
    setShowPdf(true);
    setExpandedPdf(false);
    setExpandedAI(false);
  }
  const pendingLine = useRef<number | undefined>(undefined);
  // Set by a save that compiles on save; a build already running finishes first.
  const buildAfterSave = useRef(false);
  const view = useRef<EditorView | null>(null);
  const mtime = useRef(0);
  const pdfOnly = agentMode || (expandedPdf && showPdf);
  const agentColumns = fitAgentColumns(workbenchSize.width, layout.agentWidth);
  const columns = fitThreeColumns(
    workbenchSize.width,
    layout,
    showPdf,
    showTerminal,
  );
  const fitted = columnsMode
    ? {
        ...columns,
        editor: columns.source,
        available: columns.source + columns.pdf,
      }
    : fitWorkbench(panesSize.width, layout, showPdf);
  const bottomPanel = fitBottomPanel(workbenchSize.height, layout);
  const bottomSizeKey = bottomTab === "ai" ? "ai" : "terminal";
  const dirty = text !== savedText;
  const isTex = /\.(tex|ltx)$/.test(active);
  const deferredText = useDeferredValue(text);
  const sections = useMemo(
    () => (isTex ? outline(deferredText) : []),
    [isTex, deferredText],
  );
  const topSection = Math.min(...sections.map((section) => section.depth));
  const stats = useMemo(
    () =>
      isTex
        ? `${countWords(deferredText).toLocaleString()} words`
        : `${deferredText.split("\n").length} lines`,
    [isTex, deferredText],
  );
  const problems = useMemo(
    () => parseProblems(log, project.mainFile),
    [log, project.mainFile],
  );
  // Read when a new PDF mounts the reader, so scrolling does not re-render it.
  const initialView = useMemo(
    () => (pdf ? session.pdfs[pdf.name] : undefined),
    [session, pdf?.url],
  );
  const reload = useCallback(async () => {
    try {
      setRoots(await window.research!.projectFiles(project.id));
    } catch (error) {
      report((error as Error).message);
    }
  }, [project.id, report]);
  function showFile(
    rootId: string,
    file: string,
    content: string,
    extension: Extension = [],
  ) {
    if (file !== session.file || rootId !== session.rootId)
      Object.assign(session, { rootId, file, anchor: 0, head: 0 });
    setActiveRoot(rootId);
    setActive(file);
    setSupport(extension);
    setText(content);
    setSavedText(content);
    setDiskConflict(false);
  }
  // A fresh editor per file keeps undo history separate between files.
  async function load(rootId: string, file: string, line?: number) {
    const api = window.research!;
    pendingLine.current = line;
    setLoading(true);
    try {
      const time = await api.fileMtime(project.id, file, rootId);
      const [content, extension] = await Promise.all([
        api.readFile(project.id, file, rootId),
        fileLanguage(file).load(),
      ]);
      mtime.current = time;
      showFile(rootId, file, content, extension);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const [rootId, file] = session.file
      ? [session.rootId!, session.file]
      : ["primary", project.mainFile];
    // Read the likely file while the file tree loads.
    const opened = file
      ? load(rootId, file).then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
    void window
      .research!.projectFiles(project.id)
      .then(async (list) => {
        setRoots(list);
        if (await opened) return;
        const root = list.find((root) => root.id === "primary") || list[0];
        const fallback = root?.files.includes(project.mainFile)
          ? project.mainFile
          : root?.files[0];
        if (fallback) await load(root.id, fallback);
      })
      .catch((error) => report(error.message))
      .finally(() => setLoading(false));
  }, [
    project.id,
    project.folder,
    JSON.stringify(project.localFolders),
    report,
  ]);
  useEffect(() => {
    let canceled = false;
    const api = window.research!;
    void (async () => {
      const latest = await api.lastPdf(project.id);
      if (latest) return latest;
      const [version] = await api.pdfAnnotationLibrary(project.id);
      return version ? api.openAnnotatedPdf(project.id, version.key) : null;
    })()
      .catch(() => null)
      .then((result) => {
        if (!canceled) setPdf(result);
      });
    return () => {
      canceled = true;
    };
  }, [project.id, project.folder, project.mainFile]);
  useEffect(() => {
    // The editor paints first; the shell starts once the window is idle.
    const id = requestIdleCallback(() => setTerminalReady(true), {
      timeout: 1000,
    });
    return () => cancelIdleCallback(id);
  }, []);
  useEffect(() => onStatus({ file: active, dirty }), [active, dirty]);
  async function save(manual = false) {
    if (!active) return;
    setSaving(true);
    try {
      mtime.current = await window.research!.writeFile(
        project.id,
        active,
        text,
        activeRoot,
        mtime.current || undefined,
      );
      setSavedText(text);
      setDiskConflict(false);
      if (active.endsWith(".bib")) forgetCitations(project.id);
      setFileRevision((revision) => revision + 1);
      if (
        manual &&
        project.compileOnSave &&
        activeRoot === "primary" &&
        /\.(tex|bib)$/.test(active)
      )
        buildAfterSave.current = true;
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith("Changed on disk")) setDiskConflict(true);
      else report(message);
      throw error;
    } finally {
      setSaving(false);
    }
  }
  // Replaces the buffer with the file on disk and keeps the cursor in place.
  async function reloadActive() {
    if (!active || loading) return;
    try {
      const api = window.research!;
      const time = await api.fileMtime(project.id, active, activeRoot);
      const content = await api.readFile(project.id, active, activeRoot);
      mtime.current = time;
      const editor = view.current;
      if (editor?.dom.isConnected && editor.state.doc.toString() !== content) {
        const { anchor, head } = editor.state.selection.main;
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: content },
          selection: {
            anchor: Math.min(anchor, content.length),
            head: Math.min(head, content.length),
          },
        });
      }
      setText(content);
      setSavedText(content);
      setDiskConflict(false);
    } catch {
      showFile(activeRoot, "", "");
    }
  }
  // Polled while the window is visible: a clean buffer follows the disk.
  // After "Keep mine" (mtime 0) the next save overwrites without a check.
  const checkDisk = useStableCallback(async () => {
    if (!active || !mtime.current || loading || saving || diskConflict) return;
    if (document.hidden) return;
    const time = await window
      .research!.fileMtime(project.id, active, activeRoot)
      .catch(() => 0);
    if (!time || time === mtime.current) return;
    if (dirty) setDiskConflict(true);
    else await reloadActive();
  });
  const filesChanged = useStableCallback(async () => {
    await reload();
    await reloadActive();
    setFileRevision((revision) => revision + 1);
  });
  const refreshAfterAgent = useCallback(async () => {
    try {
      await filesChanged();
      const latestPdf = await window.research!.lastPdf(project.id);
      if (latestPdf) setPdf(latestPdf);
    } catch (error) {
      report((error as Error).message);
    }
  }, [filesChanged, project.id, report]);
  const onWindowEvent = useStableCallback((event: Event) => {
    if (event.type === "focus") void checkDisk();
    else if (event instanceof KeyboardEvent) {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const typing = (event.target as Element).closest?.(
        "input, textarea, [contenteditable]",
      );
      if (key === "s") {
        event.preventDefault();
        if (!agentRunning) void save(true).catch(() => {});
      } else if (key === "enter" && !typing) {
        event.preventDefault();
        void compile();
      } else if (key === "j" && event.shiftKey) {
        event.preventDefault();
        void showInPdf();
      }
    } else if (dirty) {
      // beforeunload, or research:navigate, which continues through detail.proceed().
      event.preventDefault();
      if (event instanceof CustomEvent) setPrompt(() => event.detail.proceed);
    }
  });
  useEffect(() => {
    const types = ["keydown", "focus", "beforeunload", "research:navigate"];
    for (const type of types) window.addEventListener(type, onWindowEvent);
    const timer = setInterval(checkDisk, 2000);
    return () => {
      for (const type of types) window.removeEventListener(type, onWindowEvent);
      clearInterval(timer);
    };
  }, [onWindowEvent, checkDisk]);
  function place(editor: EditorView, line?: number) {
    const { doc } = editor.state;
    const anchor = line
      ? doc.line(Math.min(line, doc.lines)).from
      : Math.min(session.anchor ?? 0, doc.length);
    const head = line ? anchor : Math.min(session.head ?? 0, doc.length);
    editor.dispatch({
      selection: { anchor, head },
      effects: EditorView.scrollIntoView(head, { y: "center" }),
    });
    editor.focus();
  }
  const createEditor = useCallback((editor: EditorView) => {
    view.current = editor;
    place(editor, pendingLine.current);
    pendingLine.current = undefined;
  }, []);
  const trackSelection = useCallback(
    (update: ViewUpdate) => {
      if (!update.selectionSet && !update.docChanged) return;
      const { selection } = update.state;
      setSelection(
        selection.ranges
          .map((range) => update.state.sliceDoc(range.from, range.to))
          .join("\n"),
      );
      session.anchor = selection.main.anchor;
      session.head = selection.main.head;
    },
    [session],
  );
  // Runs `next` now, or after the Save / Don't save prompt when the buffer is dirty.
  const guard = (next: () => void) => (dirty ? setPrompt(() => next) : next());
  const openFile = useStableCallback(
    (file: string, rootId: string = "primary", line?: number) => {
      if (agentMode) switchMode("combined");
      if (file !== active || rootId !== activeRoot)
        guard(() =>
          load(rootId, file, line).catch((error) => report(error.message)),
        );
      else if (line)
        requestAnimationFrame(() => {
          if (view.current?.dom.isConnected) place(view.current, line);
        });
    },
  );
  const removeRoot = useStableCallback(async (rootId: string) => {
    try {
      if (dirty) await save();
    } catch {
      return;
    }
    await update({
      localFolders: (project.localFolders || []).filter(
        (root) => root.id !== rootId,
      ),
    });
  });
  const gitSave = useStableCallback(async () => {
    if (!dirty) return;
    await save();
    return active;
  });
  const toggleExpandedPdf = useCallback(() => setExpandedPdf((x) => !x), []);
  const rememberPdfView = useCallback(
    (view: PdfView) => {
      if (pdf) session.pdfs[pdf.name] = view;
    },
    [session, pdf],
  );
  async function showInPdf() {
    const editor = view.current;
    if (!editor || !pdf || !isTex) return;
    try {
      const line = editor.state.doc.lineAt(editor.state.selection.main.head);
      const target = await window.research!.synctexForward(
        project.id,
        active,
        line.number,
        activeRoot,
      );
      if (!target) return;
      setShowPdf(true);
      setReveal({ ...target, nonce: Date.now(), url: pdf.url });
    } catch (error) {
      report((error as Error).message);
    }
  }
  const inverseSearch = useStableCallback(async (target: PdfTarget) => {
    if (!pdf) return;
    const source = await window.research!.synctexInverse(
      project.id,
      target.page,
      target.x,
      target.y,
      pdf.url,
    );
    if (!source)
      throw new Error(
        "No source line was found here. Compile the manuscript to refresh its source map, then click near the text.",
      );
    setExpandedPdf(false);
    setExpandedAI(false);
    openFile(source.file, source.rootId, source.line);
  });
  const openReference = useStableCallback(
    async (reference: string, rootId: string) => {
      const target = await window.research!.openProjectReference(
        project.id,
        reference,
        rootId,
      );
      setExpandedPdf(false);
      if (target.kind === "pdf") {
        setPdf(target);
        setShowPdf(true);
      } else await openFile(target.file, target.rootId, target.line);
      setExpandedAI(false);
    },
  );
  const compile = useStableCallback(async (fromSave = false) => {
    if (busy || agentRunning || !project.folder) return;
    clearError("compile");
    if (!project.mainFile) {
      report("Set your LaTeX entry file in project details first.", "compile");
      return;
    }
    setBusy(true);
    setLog("");
    setBuildState("idle");
    if (showTerminal && !sideTools && !fromSave)
      changeLayout({ bottomTab: "build" });
    try {
      if (dirty) await save();
      const result = await window.research!.compile(project.id);
      setLog(result.log);
      setBuildState(result.ok ? "ok" : "error");
      if (result.pdf) {
        setPdf({
          url: result.pdf,
          name: project.mainFile.replace(/^.*\/|\.tex$/g, "") + ".pdf",
        });
        setShowPdf(true);
      } else if (!result.ok) {
        // A failed build restores the old PDF and map on disk. Refresh its
        // session because copying the PDF back changes its modification time.
        const previous = await window.research!.lastPdf(project.id);
        if (previous) setPdf(previous);
      }
      if (!result.ok) showTab("build");
    } catch (error) {
      setBuildState("error");
      setLog((error as Error).message);
      showTab("build");
    } finally {
      setBusy(false);
    }
  });
  useEffect(() => {
    if (busy || !buildAfterSave.current) return;
    buildAfterSave.current = false;
    void compile(true);
  }, [busy, fileRevision]);
  const setCompileOnSave = useCallback(
    (compileOnSave: boolean) => void update({ compileOnSave }),
    [update],
  );
  // Keeps the last name typed and swaps in the chosen folder.
  function startNewFile(rootId: string, folder = "") {
    setNewFile(rootId);
    setFilename((name) => (folder && folder + "/") + name.replace(/^.*\//, ""));
  }
  const fileAction = useStableCallback(
    (action: FileAction, rootId: string, path: string) => {
      const target = { rootId, path };
      if (action === "create") startNewFile(rootId, path);
      else if (action === "rename") setRenaming({ ...target, to: path });
      else if (action === "trash")
        rootId === activeRoot && path === active
          ? guard(() => setTrashing(target))
          : setTrashing(target);
      else if (action === "reveal")
        window
          .research!.revealFolder(project.id, rootId, path)
          .catch((error) => report(error.message));
      else void update({ mainFile: path });
    },
  );
  async function renameFile({
    rootId,
    path,
    to,
  }: NonNullable<typeof renaming>) {
    try {
      await window.research!.renameFile(project.id, rootId, path, to);
      setRenaming(undefined);
      if (rootId === activeRoot && path === active) {
        const extension = await fileLanguage(to).load();
        session.file = to;
        setActive(to);
        setSupport(extension);
      }
      if (rootId === "primary" && path === project.mainFile)
        await update({ mainFile: to });
      await reload();
    } catch (error) {
      report((error as Error).message);
    }
  }
  async function trashFile({ rootId, path }: NonNullable<typeof trashing>) {
    setTrashing(undefined);
    try {
      await window.research!.trashFile(project.id, rootId, path);
      if (rootId === activeRoot && path === active) {
        showFile(rootId, "", "");
        await load("primary", project.mainFile).catch(() => {});
      }
      await reload();
    } catch (error) {
      report((error as Error).message);
    }
  }
  function chooseFolder() {
    guard(async () => {
      try {
        const result = await window.research!.chooseFolder(project.id);
        if (!result) return;
        showFile("primary", "", "");
        setPdf(null);
        await update({
          folder: result.folder,
          folderLabel: "Project",
          mainFile: result.mainFile,
        });
      } catch (error) {
        report((error as Error).message);
      }
    });
  }
  async function pickPdf() {
    try {
      const result = await window.research!.choosePdf(project.id);
      if (result) setPdf(result);
    } catch (error) {
      report((error as Error).message);
    }
  }
  const extensions = useMemo(
    () => [
      EditorView.lineWrapping,
      highlighting,
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              void compile();
              return true;
            },
          },
        ]),
      ),
      support,
      isTex
        ? EditorState.languageData.of(() => [
            {
              autocomplete: latexCompletion(() =>
                citationKeys(project.id, roots),
              ),
            },
          ])
        : [],
    ],
    [support, isTex, roots],
  );
  return (
    <div
      className={`workbench mode-${layout.workMode} ${aiFocused ? "ai-focused" : ""} ${sideTools && expandedPdf && showPdf ? "pdf-focused" : ""} ${agentMode && !showTerminal ? "agent-hidden" : ""} ${columnsMode && !showTerminal ? "tools-hidden" : ""}`}
      ref={workbenchRef}
      style={
        agentMode
          ? {
              gridTemplateColumns: `${agentColumns.width}px 4px minmax(0, 1fr)`,
            }
          : columnsMode
            ? {
                gridTemplateColumns: `${columns.files}px 4px ${columns.source}px ${showTerminal || showPdf ? 4 : 0}px ${columns.agent}px ${showTerminal && showPdf ? 4 : 0}px ${columns.pdf}px`,
              }
            : undefined
      }
    >
      <div className="workbench-header">
        <div
          className="workbench-mode-switch"
          role="group"
          aria-label="Workbench mode"
        >
          <button
            type="button"
            aria-pressed={agentMode}
            title="Read the PDF and work with the agent"
            onClick={() => switchMode("agent")}
          >
            <Sparkles size={13} />
            Agent + PDF
          </button>
          <button
            type="button"
            aria-pressed={layout.workMode === "edit"}
            aria-label="Source + PDF"
            title="Edit the source beside the PDF"
            onClick={() => switchMode("edit")}
          >
            <FileText size={13} />
            Source + PDF{dirty && <i title="Unsaved source edits" />}
          </button>
          <button
            type="button"
            aria-pressed={columnsMode}
            title="Source, agent, and PDF in full-height columns"
            onClick={() => switchMode("columns")}
          >
            <PanelsTopLeft size={13} />
            Source + Agent + PDF
          </button>
          <button
            type="button"
            aria-pressed={layout.workMode === "combined"}
            title="Source and PDF above the agent and tools"
            onClick={() => switchMode("combined")}
          >
            <PanelsTopLeft size={13} />
            All panels
          </button>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button layout-reset"
            title="Reset panel layout"
            onClick={() => {
              // Sizes only; the work mode and open tab stay as chosen.
              const { sidebar, files, editorFraction, terminal, ai } =
                defaultPanelLayout;
              changeLayout({
                sidebar,
                files,
                editorFraction,
                terminal,
                ai,
                agentWidth: 0,
                sourceWidth: 0,
                columnsAgentWidth: 0,
              });
              setShowPdf(true);
              setExpandedPdf(false);
              setExpandedAI(false);
            }}
          >
            <PanelsTopLeft size={15} />
          </button>
          <GitPanel
            projectId={project.id}
            roots={roots}
            revision={fileRevision}
            onOpenFile={openFile}
            save={gitSave}
            changed={filesChanged}
            onOpenTerminal={() => {
              showTab("terminal");
              setExpandedAI(false);
              setLocalTerminalRequest((request) => request + 1);
            }}
          />
          {!agentMode && (
            <button
              className="button small"
              aria-pressed={showPdf}
              onClick={() => {
                setShowPdf((x) => !x);
                setExpandedPdf(false);
              }}
            >
              {showPdf ? (
                <PanelRightClose size={15} />
              ) : (
                <PanelRightOpen size={15} />
              )}{" "}
              PDF
            </button>
          )}
          <button
            className="button small"
            disabled={agentRunning || saving || !dirty}
            onClick={() => void save(true).catch(() => {})}
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save"} <kbd title="⌘S or Ctrl+S">⌘S</kbd>
          </button>
          <button
            className="button primary small"
            disabled={agentRunning || !project.folder || !project.mainFile}
            // The second click of a double-click must not stop the build it started.
            onClick={(event) =>
              busy
                ? event.detail < 2 &&
                  void window.research!.cancelCompile(project.id)
                : void compile()
            }
          >
            {busy ? (
              <>
                <Square size={12} /> Stop
              </>
            ) : (
              <>
                <Play size={14} /> Compile{" "}
                <kbd aria-hidden title="⌘Return or Ctrl+Return">
                  ⌘↵
                </kbd>
              </>
            )}
          </button>
        </div>
      </div>
      <div
        ref={panesRef}
        className={`workbench-panes ${pdfOnly ? "expanded-pdf" : ""}`}
      >
        <aside className="file-sidebar" style={{ width: fitted.files }}>
          <div className="pane-heading">
            PROJECT FILES
            <div>
              <button
                className="icon-button"
                title="Refresh files"
                onClick={reload}
              >
                <RefreshCw size={13} />
              </button>
              <button
                className="icon-button"
                title="New file"
                disabled={!project.folder}
                onClick={() => startNewFile("primary")}
              >
                <FilePlus2 size={14} />
              </button>
            </div>
          </div>
          <ProjectFiles
            projectId={project.id}
            roots={roots}
            active={active}
            activeRoot={activeRoot}
            mainFile={project.mainFile}
            open={openFile}
            remove={removeRoot}
            act={fileAction}
          />
          {sections.length > 0 && (
            <details className="outline">
              <summary>
                <ChevronRight size={12} />
                Outline
              </summary>
              {sections.map((section) => (
                <button
                  key={section.line}
                  title={section.title}
                  style={{
                    paddingLeft: 14 + (section.depth - topSection) * 12,
                  }}
                  onClick={() =>
                    view.current && place(view.current, section.line)
                  }
                >
                  {section.title}
                </button>
              ))}
            </details>
          )}
          <div className="file-sidebar-bottom">
            <button
              className="add-local-folder"
              onClick={() => setFolderModal(true)}
            >
              <FolderPlus size={14} /> Add local folder
            </button>
            <button onClick={chooseFolder}>
              {roots.length
                ? "Change project folder…"
                : "Choose project folder…"}
            </button>
          </div>
        </aside>
        {!pdfOnly && (
          <PanelDivider
            label="Resize project files"
            value={fitted.files}
            min={140}
            max={fitted.maxFiles}
            change={(files) => changeLayout({ files })}
            reset={() => changeLayout({ files: defaultPanelLayout.files })}
          />
        )}
        <section className="editor-pane">
          <div className="editor-tab">
            <span className="editor-file-tab" title={active || "No file open"}>
              <FileText size={14} />
              <span>{active || "No file open"}</span>
              {dirty && <i className="unsaved-dot" />}
            </span>
            <span className="editor-language">{fileLanguage(active).name}</span>
            {isTex && (
              <button
                className="icon-button"
                title="Show in PDF (⇧⌘J)"
                aria-label="Show in PDF"
                disabled={!pdf}
                onClick={() => void showInPdf()}
              >
                <Crosshair size={13} />
              </button>
            )}
          </div>
          {diskConflict && (
            <div className="disk-conflict" role="alert">
              <span>{active} changed on disk</span>
              <button onClick={() => void reloadActive()}>Reload</button>
              <button
                onClick={() => {
                  mtime.current = 0;
                  setDiskConflict(false);
                }}
              >
                Keep mine
              </button>
            </div>
          )}
          {loading ? (
            <div className="pane-empty">
              <LoaderCircle className="spin" size={24} />
              <p>Opening file…</p>
            </div>
          ) : active ? (
            <CodeMirror
              key={`${activeRoot}:${active}`}
              value={text}
              height="100%"
              theme={dark ? darkEditor : lightEditor}
              extensions={extensions}
              onChange={setText}
              readOnly={agentRunning}
              editable={!agentRunning}
              onCreateEditor={createEditor}
              onUpdate={trackSelection}
            />
          ) : (
            <div className="pane-empty">
              <FolderOpen size={32} />
              <h3>Open a local project</h3>
              <p>Attach a local project folder to edit your manuscript.</p>
              <button className="button primary" onClick={chooseFolder}>
                Choose project folder
              </button>
            </div>
          )}
          <div className="editor-status">
            <span>
              {agentRunning
                ? "Agent is working on project files"
                : dirty && "Unsaved changes"}
            </span>
            <span>
              {isTex && selection
                ? `${countWords(selection).toLocaleString()} / `
                : ""}
              {stats}
            </span>
          </div>
        </section>
        {columnsMode && !pdfOnly && (showTerminal || showPdf) && (
          <PanelDivider
            label="Resize source column"
            value={columns.source}
            min={240}
            max={columns.maxSource}
            change={(sourceWidth) => changeLayout({ sourceWidth })}
            reset={() => changeLayout({ sourceWidth: 0 })}
          />
        )}
        {showPdf && !pdfOnly && !columnsMode && (
          <PanelDivider
            label="Resize editor and PDF"
            value={fitted.editor}
            min={240}
            max={Math.max(240, fitted.available - 260)}
            change={(editor) =>
              changeLayout({ editorFraction: editor / fitted.available })
            }
            reset={() =>
              changeLayout({
                editorFraction: defaultPanelLayout.editorFraction,
              })
            }
          />
        )}
        {showPdf && (
          <section
            className="pdf-pane"
            style={{ width: pdfOnly ? "100%" : fitted.pdf }}
          >
            {pdf ? (
              <PdfReader
                key={pdf.url}
                projectId={project.id}
                pdf={pdf}
                openPdf={setPdf}
                initialView={initialView}
                onViewChange={rememberPdfView}
                reveal={reveal?.url === pdf.url ? reveal : undefined}
                onInverseSearch={inverseSearch}
                expanded={expandedPdf}
                onExpand={toggleExpandedPdf}
              />
            ) : pdf === undefined ? (
              <div className="pdf-empty">
                <LoaderCircle className="spin" size={24} />
              </div>
            ) : (
              <div className="pdf-empty">
                <div className="paper-icon">
                  <FileText size={37} strokeWidth={1} />
                </div>
                <h3>PDF preview</h3>
                <p>
                  Compile your manuscript to preview the PDF,
                  <br />
                  or open a local document.
                </p>
                <button className="button" onClick={pickPdf}>
                  <FolderOpen size={14} /> Open PDF
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      {sideTools && showTerminal && showPdf && !aiFocused && !expandedPdf && (
        <div
          className={`agent-column-divider ${columnsMode ? "three-column-divider" : ""}`}
        >
          <PanelDivider
            label="Resize agent and PDF"
            value={columnsMode ? columns.agent : agentColumns.width}
            min={360}
            max={columnsMode ? columns.maxAgent : agentColumns.max}
            change={(width) =>
              changeLayout(
                columnsMode
                  ? { columnsAgentWidth: width }
                  : { agentWidth: width },
              )
            }
            reset={() =>
              changeLayout(
                columnsMode ? { columnsAgentWidth: 0 } : { agentWidth: 0 },
              )
            }
          />
        </div>
      )}
      {showTerminal && !aiFocused && !sideTools && (
        <PanelDivider
          label={
            bottomTab === "ai" ? "Resize AI panel" : "Resize terminal panel"
          }
          orientation="horizontal"
          value={bottomPanel.height}
          min={bottomPanel.min}
          max={bottomPanel.max}
          direction={-1}
          change={(height) => changeLayout({ [bottomSizeKey]: height })}
          reset={() =>
            changeLayout({ [bottomSizeKey]: defaultPanelLayout[bottomSizeKey] })
          }
        />
      )}
      <div className="bottom-tabs">
        <button
          className={bottomTab === "terminal" && showTerminal ? "active" : ""}
          onClick={() => {
            showTab("terminal");
            setExpandedAI(false);
          }}
        >
          <TerminalSquare size={13} /> Terminal
        </button>
        <button
          className={bottomTab === "ai" && showTerminal ? "active" : ""}
          onClick={() => showTab("ai")}
        >
          <Sparkles size={13} /> AI
          {agentRunning && <LoaderCircle size={12} className="spin" />}
        </button>
        <button
          className={bottomTab === "build" && showTerminal ? "active" : ""}
          onClick={() => {
            showTab("build");
            setExpandedAI(false);
          }}
        >
          {buildState === "ok" ? (
            <CheckCircle2 size={13} />
          ) : buildState === "error" ? (
            <AlertCircle size={13} className="build-failed" />
          ) : (
            <Play size={13} />
          )}{" "}
          Build log{busy && <LoaderCircle size={12} className="spin" />}
          {problems.length > 0 && (
            <small
              className="problem-count"
              data-tone={problems.some((p) => p.error) ? "danger" : "warning"}
            >
              {problems.length}
            </small>
          )}
        </button>
        {bottomTab === "ai" && showTerminal && (
          <button
            title={aiFocused ? "Restore split view" : "Expand AI panel"}
            aria-pressed={aiFocused}
            onClick={() => setExpandedAI((value) => !value)}
          >
            <Maximize2 size={12} />
            {aiFocused ? "Split view" : "Expand AI"}
          </button>
        )}
        {showTerminal && (
          <button
            className="hide-panel"
            onClick={() => {
              changeLayout({ bottomOpen: false });
              setExpandedAI(false);
            }}
          >
            Hide panel
          </button>
        )}
      </div>
      <div
        className="bottom-panel"
        hidden={!showTerminal}
        style={{
          height: aiFocused || sideTools ? undefined : bottomPanel.height,
        }}
      >
        <div className="bottom-tab-content" hidden={bottomTab !== "terminal"}>
          {terminalReady && (
            <TerminalPanel
              project={project}
              report={report}
              localRequest={localTerminalRequest}
            />
          )}
        </div>
        <div className="bottom-tab-content" hidden={bottomTab !== "ai"}>
          <AIPanel
            key={project.id}
            project={project}
            file={active}
            rootId={activeRoot}
            text={text}
            selection={selection}
            dirty={dirty}
            prepare={async () => {
              if (dirty) await save();
            }}
            onRunning={setAgentRunning}
            onFilesChanged={refreshAfterAgent}
            onOpenReference={openReference}
            visible={
              showTerminal &&
              bottomTab === "ai" &&
              !(sideTools && expandedPdf && showPdf)
            }
          />
        </div>
        <div className="bottom-tab-content" hidden={bottomTab !== "build"}>
          <BuildLog
            projectId={project.id}
            busy={busy}
            state={buildState}
            log={log}
            problems={problems}
            open={openFile}
            compileOnSave={!!project.compileOnSave}
            setCompileOnSave={setCompileOnSave}
          />
        </div>
      </div>
      {folderModal && (
        <Modal
          title="Add a local folder"
          className="compact"
          onClose={() => setFolderModal(false)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                if (dirty) await save();
                const result = await window.research!.chooseFolder(project.id);
                if (!result) return;
                if (
                  result.folder === project.folder ||
                  project.localFolders?.some(
                    (root) => root.folder === result.folder,
                  )
                ) {
                  report("This folder is already attached to the project.");
                  return;
                }
                await update(
                  project.folder
                    ? {
                        localFolders: [
                          ...(project.localFolders || []),
                          {
                            id: crypto.randomUUID(),
                            label: folderLabel.trim(),
                            folder: result.folder,
                          },
                        ],
                      }
                    : {
                        folder: result.folder,
                        folderLabel: folderLabel.trim(),
                        mainFile: result.mainFile,
                      },
                );
                setFolderModal(false);
              } catch (error) {
                report((error as Error).message);
              }
            }}
          >
            <p className="muted">
              Keep your manuscript, code and research notes together in this
              project.
            </p>
            <label>
              Folder label
              <input
                required
                value={folderLabel}
                onChange={(event) => setFolderLabel(event.target.value)}
                list="folder-labels"
              />
            </label>
            <datalist id="folder-labels">
              <option value="Manuscript" />
              <option value="Code" />
              <option value="Notes" />
              <option value="Experiments" />
            </datalist>
            <div className="modal-actions">
              <button className="button primary">Choose local folder</button>
            </div>
          </form>
        </Modal>
      )}
      {newFile && (
        <Modal
          title="New project file"
          className="compact"
          onClose={() => setNewFile(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await window.research!.createFile(
                  project.id,
                  filename,
                  newFile,
                );
                await reload();
                setNewFile(undefined);
                openFile(filename, newFile);
              } catch (error) {
                report((error as Error).message);
              }
            }}
          >
            <label>
              Filename
              <input
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                required
              />
            </label>
            <p className="muted">
              Created in{" "}
              {roots.find((root) => root.id === newFile)?.label ??
                "the project folder"}
              . Supports .tex, .bib, .md, and .txt.
            </p>
            <div className="modal-actions">
              <button className="button primary">Create file</button>
            </div>
          </form>
        </Modal>
      )}
      {renaming && (
        <Modal
          title="Rename file"
          className="compact"
          onClose={() => setRenaming(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void renameFile(renaming);
            }}
          >
            <label>
              Filename
              <input
                value={renaming.to}
                onChange={(event) =>
                  setRenaming({ ...renaming, to: event.target.value })
                }
                required
                data-autofocus
              />
            </label>
            <div className="modal-actions">
              <button className="button primary">Rename</button>
            </div>
          </form>
        </Modal>
      )}
      {trashing && (
        <Modal
          title={`Move ${trashing.path} to Trash?`}
          className="compact"
          onClose={() => setTrashing(undefined)}
        >
          <p className="muted">You can restore it from the Trash in Finder.</p>
          <div className="modal-actions">
            <button className="button" onClick={() => setTrashing(undefined)}>
              Cancel
            </button>
            <button
              className="button primary danger"
              onClick={() => void trashFile(trashing)}
            >
              Move to Trash
            </button>
          </div>
        </Modal>
      )}
      {prompt && (
        <Modal
          title={`Save changes to ${active}?`}
          className="compact"
          onClose={() => setPrompt(null)}
        >
          <p className="muted">Your changes are lost if you don't save them.</p>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                setPrompt(null);
                prompt();
              }}
            >
              Don't save
            </button>
            <button className="button" onClick={() => setPrompt(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              data-autofocus
              onClick={async () => {
                setPrompt(null);
                try {
                  await save();
                  prompt();
                } catch {
                  /* save() reported the failure. */
                }
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export default memo(Workbench);
