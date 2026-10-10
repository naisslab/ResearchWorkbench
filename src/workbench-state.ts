import type { PdfView } from "./pdf-types";

export interface WorkbenchSession {
  rootId?: string;
  file?: string;
  anchor?: number;
  head?: number;
  pdfs: Record<string, PdfView>;
  pdfKey?: string;
  pdfArchived?: boolean;
  recent?: { rootId: string; file: string }[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const position = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Preferences are optional. Keep valid entries when an older or damaged entry is unusable. */
export function readSessions(
  raw: string | null,
): Map<string, WorkbenchSession> {
  const sessions = new Map<string, WorkbenchSession>();
  try {
    const entries: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(entries)) return sessions;
    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      const [id, value] = entry;
      if (typeof id !== "string" || !record(value)) continue;
      const session: WorkbenchSession = { pdfs: Object.create(null) };
      for (const key of ["rootId", "file", "pdfKey"] as const)
        if (typeof value[key] === "string") session[key] = value[key];
      if (session.file && !session.rootId) session.rootId = "primary";
      for (const key of ["anchor", "head"] as const)
        if (position(value[key])) session[key] = value[key];
      if (typeof value.pdfArchived === "boolean")
        session.pdfArchived = value.pdfArchived;
      if (record(value.pdfs))
        for (const [name, view] of Object.entries(value.pdfs)) {
          if (
            !record(view) ||
            !position(view.page) ||
            view.page < 1 ||
            typeof view.offset !== "number" ||
            !Number.isFinite(view.offset) ||
            typeof view.zoom !== "number" ||
            !Number.isFinite(view.zoom)
          )
            continue;
          session.pdfs[name] = {
            page: view.page,
            offset: Math.max(0, Math.min(1, view.offset)),
            zoom: Math.max(0.6, Math.min(2.5, view.zoom)),
            showNotes: view.showNotes === true,
          };
        }
      if (Array.isArray(value.recent))
        session.recent = value.recent
          .filter(
            (item): item is { rootId: string; file: string } =>
              record(item) &&
              typeof item.rootId === "string" &&
              typeof item.file === "string",
          )
          .slice(0, 20);
      sessions.set(id, session);
    }
  } catch {
    /* Missing preferences never block opening a project. */
  }
  return sessions;
}

export function readChatDraft(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key: string,
  legacyKey?: string,
) {
  const saved = storage.getItem(key);
  const legacy = legacyKey ? storage.getItem(legacyKey) : null;
  if (legacyKey && legacy !== null) {
    // Migrate once; otherwise an empty, sent draft resurrects the old value.
    if (saved === null) storage.setItem(key, legacy);
    storage.removeItem(legacyKey);
  }
  return saved ?? legacy ?? "";
}
