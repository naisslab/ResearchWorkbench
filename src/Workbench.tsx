import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { fileLanguage } from "./syntax";
import {
  Play,
  Save,
  FileText,
  FolderOpen,
  ChevronRight,
  TerminalSquare,
  FilePlus2,
  RefreshCw,
  Settings2,
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
import ProjectFiles from "./ProjectFiles";
import TerminalPanel from "./TerminalPanel";
import AIPanel from "./AIPanel";
import { useColorTheme } from "./theme";
import PanelDivider from "./PanelDivider";
import {
  clamp,
  defaultPanelLayout,
  fitWorkbench,
  type PanelLayout,
} from "./panel-layout";
import { usePanelSize } from "./usePanelLayout";
const snazzyLightTheme = EditorView.theme(
  {
    "&": { color: "#565869", backgroundColor: "#fafbfc" },
    ".cm-content": { caretColor: "#565869" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#565869" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#dceef8",
    },
    ".cm-gutters": {
      backgroundColor: "#fafbfc",
      color: "#9194a2",
      border: "none",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#e3eff7",
      outline: "1px solid #89b5cb",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#e9eaeb",
      color: "#777985",
      borderColor: "#dedfe0",
    },
  },
  { dark: false },
);
const snazzyLightHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.tagName], color: "#c25193" },
    { tag: [tags.string, tags.attributeValue], color: "#9a7400" },
    { tag: [tags.comment], color: "#9194a2" },
    { tag: [tags.number], color: "#d34b47" },
    { tag: [tags.bool, tags.null, tags.atom], color: "#238744" },
    { tag: [tags.typeName, tags.className], color: "#00918d" },
    { tag: [tags.propertyName], color: "#11658f" },
    { tag: [tags.regexp], color: "#c25193" },
    { tag: [tags.variableName, tags.attributeName], color: "#11658f" },
    { tag: [tags.function(tags.variableName)], color: "#087cba" },
    { tag: [tags.heading], color: "#238744" },
    { tag: [tags.bracket, tags.punctuation], color: "#777985" },
    { tag: [tags.operator], color: "#00918d" },
  ]),
);
const snazzyDarkTheme = EditorView.theme(
  {
    "&": { color: "#cccccc", backgroundColor: "#1f1f1f" },
    ".cm-content": { caretColor: "#cccccc" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#cccccc" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#264f78",
    },
    ".cm-gutters": {
      backgroundColor: "#1f1f1f",
      color: "#6e7681",
      border: "none",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#313131",
      outline: "1px solid #888888",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#252526",
      color: "#b4b4b4",
      borderColor: "#3c3c3c",
    },
  },
  { dark: true },
);
const snazzyDarkHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.tagName], color: "#c586c0" },
    { tag: [tags.string, tags.attributeValue], color: "#ce9178" },
    { tag: [tags.comment], color: "#6a9955" },
    { tag: [tags.number], color: "#b5cea8" },
    { tag: [tags.bool, tags.null, tags.atom], color: "#569cd6" },
    { tag: [tags.typeName, tags.className], color: "#4ec9b0" },
    { tag: [tags.propertyName], color: "#9cdcfe" },
    { tag: [tags.regexp], color: "#d16969" },
    { tag: [tags.variableName, tags.attributeName], color: "#9cdcfe" },
    { tag: [tags.function(tags.variableName)], color: "#dcdcaa" },
    { tag: [tags.heading], color: "#4ec9b0" },
    { tag: [tags.bracket, tags.punctuation], color: "#cccccc" },
    { tag: [tags.operator], color: "#d4d4d4" },
  ]),
);
export default function Workbench({
  project,
  update,
  report,
  details,
  layout,
  changeLayout,
}: {
  project: Project;
  update(changes: Partial<Project>): Promise<void>;
  report(message: string): void;
  details(): void;
  layout: PanelLayout;
  changeLayout(changes: Partial<PanelLayout>): void;
}) {
  const [panesRef, panesSize] = usePanelSize();
  const [workbenchRef, workbenchSize] = usePanelSize();
  const dark = useColorTheme();
  const [roots, setRoots] = useState<ProjectFileRoot[]>([]);
  const [fileRevision, setFileRevision] = useState(0);
  const [activeRoot, setActiveRoot] = useState("primary");
  const [folderModal, setFolderModal] = useState(false);
  const [folderLabel, setFolderLabel] = useState("Code");
  const [active, setActive] = useState("");
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const [showPdf, setShowPdf] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [bottomTab, setBottomTab] = useState<"terminal" | "ai" | "build">(
    "terminal",
  );
  const [agentRunning, setAgentRunning] = useState(false);
  const [selection, setSelection] = useState("");
  const [log, setLog] = useState("");
  const [buildState, setBuildState] = useState<"idle" | "ok" | "error">("idle");
  const [newFile, setNewFile] = useState(false);
  const [filename, setFilename] = useState("section.tex");
  const [expandedPdf, setExpandedPdf] = useState(false);
  const pdfOnly = expandedPdf && showPdf;
  const fitted = fitWorkbench(panesSize.width, layout, showPdf);
  const maxTerminal = Math.max(120, Math.min(600, workbenchSize.height - 300));
  const terminalHeight = clamp(layout.terminal, 120, maxTerminal);
  const dirty = text !== savedText;
  const currentProject = useRef(project.id);
  currentProject.current = project.id;
  const logElement = useRef<HTMLPreElement>(null);
  const reload = useCallback(async () => {
    try {
      setRoots(await window.research!.projectFiles(project.id));
    } catch (error) {
      report((error as Error).message);
    }
  }, [project.id, report]);
  useEffect(() => {
    let canceled = false;
    void window.research
      ?.projectFiles(project.id)
      .then(async (list) => {
        if (canceled) return;
        setRoots(list);
        const root = list.find((root) => root.id === "primary") || list[0];
        const file = root?.files.includes(project.mainFile)
          ? project.mainFile
          : root?.files[0];
        setActive("");
        setText("");
        setSavedText("");
        if (file) {
          setLoading(true);
          try {
            const content = await window.research!.readFile(
              project.id,
              file,
              root!.id,
            );
            if (!canceled) {
              setActiveRoot(root!.id);
              setActive(file);
              setText(content);
              setSavedText(content);
            }
          } catch (error) {
            if (!canceled) report((error as Error).message);
          } finally {
            if (!canceled) setLoading(false);
          }
        }
      })
      .catch((error) => report(error.message));
    return () => {
      canceled = true;
    };
  }, [
    project.id,
    project.folder,
    JSON.stringify(project.localFolders),
    report,
  ]);
  useEffect(() => {
    let canceled = false;
    void window.research
      ?.lastPdf(project.id)
      .then(async (result) => {
        if (canceled) return;
        if (result) setPdf(result);
        else {
          const versions = await window.research!.pdfAnnotationLibrary(
            project.id,
          );
          if (!canceled && versions.length) {
            const archived = await window.research!.openAnnotatedPdf(
              project.id,
              versions[0].key,
            );
            if (!canceled) setPdf(archived);
          }
        }
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [project.id, project.folder, project.mainFile]);
  useEffect(
    () =>
      window.research?.onCompileOutput((data) => {
        if (data.projectId === project.id)
          setLog((previous) => (previous + data.text).slice(-150000));
      }),
    [project.id],
  );
  useEffect(() => {
    if (logElement.current)
      logElement.current.scrollTop = logElement.current.scrollHeight;
  }, [log]);
  const save = useCallback(async () => {
    if (!active || !window.research) return;
    setSaving(true);
    try {
      await window.research.writeFile(project.id, active, text, activeRoot);
      setSavedText(text);
      setFileRevision((revision) => revision + 1);
    } catch (error) {
      report((error as Error).message);
      throw error;
    } finally {
      setSaving(false);
    }
  }, [active, activeRoot, text, project.id, report]);
  const refreshAfterAgent = useCallback(async () => {
    const id = project.id;
    setLoading(true);
    try {
      await reload();
      if (active) {
        try {
          const content = await window.research!.readFile(
            id,
            active,
            activeRoot,
          );
          if (currentProject.current === id) {
            setText(content);
            setSavedText(content);
          }
        } catch {
          if (currentProject.current === id) {
            setActive("");
            setText("");
            setSavedText("");
          }
        }
      }
      const latestPdf = await window.research!.lastPdf(id);
      if (currentProject.current === id && latestPdf) setPdf(latestPdf);
      setFileRevision((revision) => revision + 1);
    } catch (error) {
      report((error as Error).message);
    } finally {
      if (currentProject.current === id) setLoading(false);
    }
  }, [active, activeRoot, project.id, reload, report]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!agentRunning) void save().catch(() => {});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save, agentRunning]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    const guard = (event: Event) => {
      if (
        dirty &&
        !window.confirm("Discard unsaved file changes? Use ⌘S to save first.")
      )
        event.preventDefault();
    };
    window.addEventListener("research:navigate", guard);
    return () => window.removeEventListener("research:navigate", guard);
  }, [dirty]);
  async function openFile(file: string, rootId = "primary") {
    if (dirty && !window.confirm("Discard unsaved file changes?")) return;
    setLoading(true);
    try {
      const content = await window.research!.readFile(project.id, file, rootId);
      setActiveRoot(rootId);
      setActive(file);
      setText(content);
      setSavedText(content);
    } catch (error) {
      report((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function compile() {
    if (!project.mainFile) {
      report("Set your LaTeX entry file in project details first.");
      return;
    }
    setBusy(true);
    setLog("");
    setBuildState("idle");
    setShowTerminal(true);
    setBottomTab("build");
    const id = project.id;
    try {
      if (dirty) await save();
      const result = await window.research!.compile(id);
      if (currentProject.current !== id) return;
      setLog(result.log);
      setBuildState(result.ok ? "ok" : "error");
      if (result.pdf) {
        setPdf({
          url: result.pdf,
          name: project.mainFile.replace(/\.tex$/, ".pdf"),
        });
        setShowPdf(true);
      }
      if (!result.ok)
        report("Compilation failed. See the build log for the LaTeX error.");
    } catch (error) {
      setBuildState("error");
      setLog((error as Error).message);
      report((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function chooseFolder() {
    if (
      dirty &&
      !window.confirm("Discard unsaved file changes before changing folders?")
    )
      return;
    try {
      const result = await window.research!.chooseFolder(project.id);
      if (result) {
        await update({
          folder: result.folder,
          folderLabel: "Project",
          mainFile: result.files.includes("main.tex")
            ? "main.tex"
            : result.files.find((f) => f.endsWith(".tex")) || "",
        });
        setActive("");
        setText("");
        setSavedText("");
        setPdf(null);
      }
    } catch (error) {
      report((error as Error).message);
    }
  }
  return (
    <div className="workbench" ref={workbenchRef}>
      <div className="workbench-header">
        <div className="crumb">
          <span>Workbench</span>
          <ChevronRight size={14} />
          <strong>{project.name}</strong>
          {project.example && <span className="sample-tag">EXAMPLE</span>}
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button layout-reset"
            title="Reset panel layout"
            onClick={() => {
              changeLayout(defaultPanelLayout);
              setExpandedPdf(false);
            }}
          >
            <PanelsTopLeft size={15} />
          </button>
          <GitPanel
            key={project.id}
            projectId={project.id}
            roots={roots}
            revision={fileRevision}
            save={async () => {
              if (dirty) await save();
            }}
            changed={async () => {
              await reload();
              if (active) {
                const content = await window.research!.readFile(
                  project.id,
                  active,
                  activeRoot,
                );
                setText(content);
                setSavedText(content);
              }
              setFileRevision((revision) => revision + 1);
            }}
          />
          <button className="button small" onClick={details}>
            <Settings2 size={14} /> Project details
          </button>
          <button
            className="button small"
            onClick={() => setShowPdf((x) => !x)}
          >
            {showPdf ? (
              <PanelRightClose size={15} />
            ) : (
              <PanelRightOpen size={15} />
            )}{" "}
            PDF
          </button>
          <button
            className="button small"
            disabled={agentRunning || saving || !dirty}
            onClick={() => void save().catch(() => {})}
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save"} <kbd title="⌘S or Ctrl+S">⌘S</kbd>
          </button>
          <button
            className="button primary small"
            disabled={
              agentRunning || busy || !project.folder || !project.mainFile
            }
            onClick={compile}
          >
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Play size={14} />
            )}{" "}
            {busy ? "Compiling…" : "Compile"}
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
                onClick={() => setNewFile(true)}
              >
                <FilePlus2 size={14} />
              </button>
            </div>
          </div>
          <ProjectFiles
            key={project.id}
            projectId={project.id}
            roots={roots}
            active={active}
            activeRoot={activeRoot}
            mainFile={project.mainFile}
            open={openFile}
            attach={() => setFolderModal(true)}
            change={chooseFolder}
            remove={async (rootId) => {
              if (dirty) {
                try {
                  await save();
                } catch {
                  return;
                }
              }
              await update({
                localFolders: (project.localFolders || []).filter(
                  (root) => root.id !== rootId,
                ),
              });
            }}
          />
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
          </div>
          {loading ? (
            <div className="pane-empty">
              <LoaderCircle className="spin" size={24} />
              <p>Opening file…</p>
            </div>
          ) : active ? (
            <CodeMirror
              value={text}
              height="100%"
              extensions={[
                EditorView.lineWrapping,
                dark ? snazzyDarkHighlighting : snazzyLightHighlighting,
                ...fileLanguage(active).extensions,
              ]}
              onChange={setText}
              readOnly={agentRunning}
              editable={!agentRunning}
              onUpdate={(update) => {
                if (update.selectionSet || update.docChanged)
                  setSelection(
                    update.state.selection.ranges
                      .map((range) =>
                        update.state.doc.sliceString(range.from, range.to),
                      )
                      .join("\n"),
                  );
              }}
              basicSetup={{
                foldGutter: true,
                highlightActiveLine: true,
                lineNumbers: true,
              }}
              theme={dark ? snazzyDarkTheme : snazzyLightTheme}
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
                : dirty
                  ? "Unsaved changes"
                  : active
                    ? "All changes saved"
                    : "No file selected"}
            </span>
            <span>
              UTF-8 <span className="status-separator">·</span>{" "}
              {text.split("\n").length} lines
            </span>
          </div>
        </section>
        {showPdf && !pdfOnly && (
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
            <div className="pane-heading">
              <span>
                <FileText size={14} /> {pdf?.name || "PDF PREVIEW"}
              </span>
              <div>
                <button
                  className="icon-button"
                  title={pdfOnly ? "Restore split view" : "Expand PDF preview"}
                  onClick={() => setExpandedPdf((x) => !x)}
                >
                  <Maximize2 size={14} />
                </button>
                <button
                  className="button text small"
                  onClick={async () => {
                    try {
                      const result = await window.research!.choosePdf(
                        project.id,
                      );
                      if (result) setPdf(result);
                    } catch (error) {
                      report((error as Error).message);
                    }
                  }}
                >
                  Open PDF
                </button>
              </div>
            </div>
            {pdf ? (
              <PdfReader
                key={pdf.url}
                projectId={project.id}
                pdf={pdf}
                openPdf={setPdf}
              />
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
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      const result = await window.research!.choosePdf(
                        project.id,
                      );
                      if (result) setPdf(result);
                    } catch (error) {
                      report((error as Error).message);
                    }
                  }}
                >
                  <FolderOpen size={14} /> Open a PDF
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      {showTerminal && (
        <PanelDivider
          label="Resize terminal panel"
          orientation="horizontal"
          value={terminalHeight}
          min={120}
          max={maxTerminal}
          direction={-1}
          change={(terminal) => changeLayout({ terminal })}
          reset={() => changeLayout({ terminal: defaultPanelLayout.terminal })}
        />
      )}
      <div className="bottom-tabs">
        <button
          className={bottomTab === "terminal" && showTerminal ? "active" : ""}
          onClick={() => {
            setBottomTab("terminal");
            setShowTerminal(true);
          }}
        >
          <TerminalSquare size={13} /> Terminal
        </button>
        <button
          className={bottomTab === "ai" && showTerminal ? "active" : ""}
          onClick={() => {
            setBottomTab("ai");
            setShowTerminal(true);
            if (layout.terminal < 270) changeLayout({ terminal: 300 });
          }}
        >
          <Sparkles size={13} /> AI
          {agentRunning && <LoaderCircle size={12} className="spin" />}
        </button>
        <button
          className={bottomTab === "build" && showTerminal ? "active" : ""}
          onClick={() => {
            setBottomTab("build");
            setShowTerminal(true);
          }}
        >
          {buildState === "ok" ? (
            <CheckCircle2 size={13} />
          ) : buildState === "error" ? (
            <AlertCircle size={13} />
          ) : (
            <Play size={13} />
          )}{" "}
          Build log{busy && <LoaderCircle size={12} className="spin" />}
        </button>
        <span>
          {project.mainFile
            ? `Entry: ${project.mainFile}`
            : "No LaTeX entry file selected"}
        </span>
        {showTerminal && (
          <button className="hide-panel" onClick={() => setShowTerminal(false)}>
            Hide panel
          </button>
        )}
      </div>
      <div
        className="bottom-panel"
        hidden={!showTerminal}
        style={{ height: terminalHeight }}
      >
        <div className="bottom-tab-content" hidden={bottomTab !== "terminal"}>
          <TerminalPanel
            project={project}
            onClose={() => setShowTerminal(false)}
            report={report}
          />
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
          />
        </div>
        <div className="bottom-tab-content" hidden={bottomTab !== "build"}>
          <div className="build-panel">
            <div className="build-summary">
              <i className={buildState === "ok" ? "live-dot" : "idle-dot"} />
              {busy
                ? "Compiling with latexmk…"
                : buildState === "ok"
                  ? "Build succeeded · PDF updated"
                  : buildState === "error"
                    ? "Build failed"
                    : "Ready to compile"}
              <span>latexmk · pdfLaTeX · shell escape disabled</span>
            </div>
            <pre ref={logElement}>
              {log ||
                "Click Compile to build your LaTeX project. Compiler output will appear here."}
            </pre>
          </div>
        </div>
      </div>
      {folderModal && (
        <div className="modal-backdrop">
          <form
            className="modal compact"
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
                if (!project.folder)
                  await update({
                    folder: result.folder,
                    folderLabel: folderLabel.trim(),
                    mainFile: result.files.includes("main.tex")
                      ? "main.tex"
                      : result.files.find((file) => file.endsWith(".tex")) ||
                        "",
                  });
                else
                  await update({
                    localFolders: [
                      ...(project.localFolders || []),
                      {
                        id: crypto.randomUUID(),
                        label: folderLabel.trim(),
                        folder: result.folder,
                      },
                    ],
                  });
                setFolderModal(false);
              } catch (error) {
                report((error as Error).message);
              }
            }}
          >
            <h2>Add a local folder</h2>
            <p className="muted">
              Keep your manuscript, code and research notes together in this
              project.
            </p>
            <label>
              Folder label
              <input
                autoFocus
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
              <button
                type="button"
                className="button"
                onClick={() => setFolderModal(false)}
              >
                Cancel
              </button>
              <button className="button primary">Choose local folder</button>
            </div>
          </form>
        </div>
      )}
      {newFile && (
        <div className="modal-backdrop">
          <form
            className="modal compact"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await window.research!.createFile(project.id, filename);
                await reload();
                setNewFile(false);
                await openFile(filename);
              } catch (error) {
                report((error as Error).message);
              }
            }}
          >
            <h2>New project file</h2>
            <label>
              Filename
              <input
                autoFocus
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                required
              />
            </label>
            <p className="muted">
              Created in the project folder. Supports .tex, .bib, .md, and .txt.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setNewFile(false)}
              >
                Cancel
              </button>
              <button className="button primary">Create file</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
