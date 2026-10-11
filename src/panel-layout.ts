export interface PanelLayout {
  sidebar: number;
  files: number;
  editorFraction: number;
  terminal: number;
  ai: number;
  workMode: "agent" | "edit" | "combined" | "columns";
  agentWidth: number;
  sourceWidth: number;
  columnsAgentWidth: number;
  sidebarCollapsed: boolean;
  bottomOpen: boolean;
  bottomTab: string;
}
export type SidebarLayout = Pick<PanelLayout, "sidebar" | "sidebarCollapsed">;
export type WorkbenchLayout = Omit<PanelLayout, keyof SidebarLayout>;

export const defaultPanelLayout: PanelLayout = {
  sidebar: 248,
  files: 220,
  editorFraction: 0.52,
  terminal: 210,
  ai: 0,
  workMode: "agent",
  agentWidth: 0,
  sourceWidth: 0,
  columnsAgentWidth: 0,
  sidebarCollapsed: false,
  bottomOpen: true,
  bottomTab: "ai",
};
export const panelLayoutKey = "research-workbench.panels.v1";
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
// Older saved layouts lack the newer keys; missing or mistyped values keep their defaults.
export function parsePanelLayout(value: string | null): PanelLayout {
  const next = { ...defaultPanelLayout };
  try {
    const saved = Object(JSON.parse(value || "{}"));
    for (const key of Object.keys(next) as (keyof PanelLayout)[])
      if (typeof saved[key] === typeof next[key])
        (next as Record<string, unknown>)[key] = saved[key];
    if (!saved.workMode) {
      next.bottomTab = "ai";
      next.bottomOpen = true;
    }
  } catch {
    /* Corrupt storage keeps the defaults. */
  }
  return {
    ...next,
    sidebar: clamp(next.sidebar, 180, 420),
    files: clamp(next.files, 140, 420),
    editorFraction: clamp(next.editorFraction, 0.01, 0.99),
    terminal: clamp(next.terminal, 120, 600),
    ai: next.ai === 0 ? 0 : clamp(next.ai, 340, 1200),
    workMode: ["agent", "edit", "combined", "columns"].includes(next.workMode)
      ? next.workMode
      : "agent",
    agentWidth: next.agentWidth === 0 ? 0 : clamp(next.agentWidth, 360, 900),
    sourceWidth:
      next.sourceWidth === 0 ? 0 : clamp(next.sourceWidth, 240, 2400),
    columnsAgentWidth:
      next.columnsAgentWidth === 0
        ? 0
        : clamp(next.columnsAgentWidth, 360, 1600),
  };
}
// Keep each column readable. Compact windows can scroll horizontally while
// retaining all three panels and the user's preferred sizes for a larger screen.
export function fitThreeColumns(
  width: number,
  layout: WorkbenchLayout,
  showPdf: boolean,
  showTools: boolean,
) {
  const separators =
    4 + (showPdf || showTools ? 4 : 0) + (showPdf && showTools ? 4 : 0);
  const minAgent = showTools ? 360 : 0;
  const minPdf = showPdf ? 260 : 0;
  const fittedWidth = Math.max(
    width,
    140 + 240 + minAgent + minPdf + separators,
  );
  const maxFiles = Math.min(
    420,
    fittedWidth - 240 - minAgent - minPdf - separators,
  );
  const files = clamp(layout.files, 140, maxFiles);
  const available = fittedWidth - files - separators;
  const initial = available / (1 + Number(showPdf) + Number(showTools));
  const source =
    showPdf || showTools
      ? clamp(layout.sourceWidth || initial, 240, available - minAgent - minPdf)
      : available;
  const maxAgent = Math.min(1600, available - source - minPdf);
  const agent = showTools
    ? showPdf
      ? clamp(layout.columnsAgentWidth || initial, 360, maxAgent)
      : available - source
    : 0;
  return {
    files,
    source,
    agent,
    pdf: showPdf ? available - source - agent : 0,
    maxFiles,
    maxSource: Math.min(2400, available - agent - minPdf),
    maxAgent,
  };
}
export function fitAgentColumns(width: number, preferred: number) {
  const max = Math.max(360, width - 324);
  return {
    width: clamp(preferred || width * 0.44, 360, Math.min(900, max)),
    max: Math.min(900, max),
  };
}
// A conversation needs room for both its transcript and composer. Zero means
// an automatic starting size, including layouts saved before AI had its own size.
export function fitBottomPanel(height: number, layout: WorkbenchLayout) {
  if (layout.bottomTab !== "ai") {
    const max = Math.max(120, Math.min(600, height - 300));
    return { height: clamp(layout.terminal, 120, max), min: 120, max };
  }
  const available = Math.max(0, height - 80);
  const max = Math.max(0, available - 180);
  const min = Math.min(340, max);
  const initial = clamp(height * 0.52, Math.min(400, max), Math.min(600, max));
  return { height: clamp(layout.ai || initial, min, max), min, max };
}
export function fitWorkbench(
  width: number,
  layout: WorkbenchLayout,
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
