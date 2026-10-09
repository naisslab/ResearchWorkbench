export interface PanelLayout {
  sidebar: number;
  files: number;
  editorFraction: number;
  terminal: number;
}
export const defaultPanelLayout: PanelLayout = {
  sidebar: 248,
  files: 220,
  editorFraction: 0.52,
  terminal: 210,
};
export const panelLayoutKey = "research-workbench.panels.v1";
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
export function parsePanelLayout(value: string | null): PanelLayout {
  try {
    const parsed = JSON.parse(value || "null");
    const next = { ...defaultPanelLayout };
    if (!parsed || typeof parsed !== "object") return next;
    for (const key of Object.keys(next) as (keyof PanelLayout)[]) {
      if (typeof parsed[key] === "number" && Number.isFinite(parsed[key]))
        next[key] = parsed[key];
    }
    return {
      sidebar: clamp(next.sidebar, 180, 420),
      files: clamp(next.files, 140, 420),
      editorFraction: clamp(next.editorFraction, 0.01, 0.99),
      terminal: clamp(next.terminal, 120, 600),
    };
  } catch {
    return { ...defaultPanelLayout };
  }
}
export function fitWorkbench(
  width: number,
  layout: PanelLayout,
  showPdf: boolean,
) {
  const separatorSpace = showPdf ? 8 : 4;
  const maxFiles = Math.min(
    420,
    width - separatorSpace - 240 - (showPdf ? 260 : 0),
  );
  const files = clamp(layout.files, 140, maxFiles);
  const available = Math.max(0, width - files - separatorSpace);
  const editor = showPdf
    ? clamp(available * layout.editorFraction, 240, available - 260)
    : available;
  return {
    files,
    editor,
    pdf: showPdf ? Math.max(0, available - editor) : 0,
    available,
    maxFiles: Math.max(140, maxFiles),
  };
}
