import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "./types";

type BufferState = {
  project: Project;
  file: string;
  rootId: string;
  text: string;
  base: string;
  loading: boolean;
  visible: boolean;
};
const identity = (project: Project, rootId: string, file: string) =>
  JSON.stringify([
    project.id,
    rootId,
    file,
    rootId === "primary"
      ? project.folder
      : project.localFolders?.find((root) => root.id === rootId)?.folder,
  ]);

/** Owns recovery status and every automatic/manual draft flush for one editor. */
export function useEditorDraft(buffer: BufferState) {
  const latest = useRef(buffer);
  latest.current = buffer;
  const loaded = useRef("");
  const loadFailed = useRef(false);
  const restoring = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState({
    recovered: false,
    error: "",
    loadFailed: false,
  });
  const cancelTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const read = useCallback(
    async (rootId: string, file: string, content: string) => {
      cancelTimer();
      const { project } = latest.current;
      loaded.current = identity(project, rootId, file);
      loadFailed.current = false;
      try {
        const draft = await window.research!.readDraft(
          project.id,
          file,
          rootId,
        );
        setStatus({
          recovered: !!draft && draft.text !== content,
          error: "",
          loadFailed: false,
        });
        return draft;
      } catch (error) {
        loadFailed.current = true;
        setStatus({
          recovered: false,
          error: (error as Error).message,
          loadFailed: true,
        });
        return null;
      }
    },
    [cancelTimer],
  );
  const flush = useCallback(
    async (discard = false) => {
      cancelTimer();
      const { project, file, rootId, text, base, loading } = latest.current;
      if (
        !file ||
        loading ||
        restoring.current ||
        loaded.current !== identity(project, rootId, file)
      )
        return;
      // Preserve unreadable copies until the user explicitly resolves them.
      if (loadFailed.current && !discard) return;
      try {
        await window.research!.writeDraft(
          project.id,
          file,
          rootId,
          !discard && text !== base ? { text, base } : null,
        );
        setStatus((previous) => ({ ...previous, error: "" }));
      } catch (error) {
        setStatus((previous) => ({
          ...previous,
          error: (error as Error).message,
        }));
        throw error;
      }
    },
    [cancelTimer],
  );
  // Finish this copy before a save-and-switch can load another file. Keep
  // any text typed while the manuscript save was in flight.
  const saved = useCallback(async (base: string) => {
    loadFailed.current = false;
    setStatus({ recovered: false, error: "", loadFailed: false });
    const { project, file, rootId, text } = latest.current;
    try {
      await window.research!.writeDraft(
        project.id,
        file,
        rootId,
        text !== base ? { text, base } : null,
      );
    } catch (error) {
      setStatus((previous) => ({
        ...previous,
        error: (error as Error).message,
      }));
    }
  }, []);
  const key = identity(buffer.project, buffer.rootId, buffer.file);
  useEffect(() => {
    if (buffer.loading || !buffer.file || loaded.current !== key) return;
    timer.current ??= setTimeout(() => void flush().catch(() => {}), 250);
  }, [key, buffer.text, buffer.base, buffer.loading, flush]);
  useEffect(() => cancelTimer, [key, buffer.loading, cancelTimer]);
  useEffect(() => {
    if (!buffer.visible) void flush().catch(() => {});
  }, [buffer.visible, flush]);
  useEffect(() => {
    const pagehide = () => void flush().catch(() => {});
    const backup = (event: Event) =>
      (event as CustomEvent<Promise<void>[]>).detail.push(flush());
    const restore = () => {
      restoring.current = true;
      cancelTimer();
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("research:flush-drafts", backup);
    window.addEventListener("research-workbench:restore", restore);
    return () => {
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("research:flush-drafts", backup);
      window.removeEventListener("research-workbench:restore", restore);
      cancelTimer();
    };
  }, [flush, cancelTimer]);
  return { ...status, read, flush, saved };
}
