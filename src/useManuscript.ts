import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFileRoot } from "./types";
import { readManuscript, type ManuscriptFile } from "./latex-project.ts";

/**
 * The files of the project's manuscript. A save re-reads the saved file; a
 * file-tree change re-reads them all. The open file contributes its unsaved
 * text.
 */
export function useManuscript(
  projectId: string,
  mainFile: string | undefined,
  roots: ProjectFileRoot[],
  revision: number,
  active: { file: string; rootId: string; text: string },
  /** Bumped when files may have changed outside the app: all are re-read. */
  external: number,
) {
  const [{ sources, readFor }, setRead] = useState({
    sources: [] as ManuscriptFile[],
    readFor: -1,
  });
  const cache = useRef(new Map<string, ManuscriptFile | null>());
  // Bumped whenever cached text is dropped, so a read that started earlier
  // does not put its older text back.
  const epoch = useRef(0);
  const saved = useRef(active);
  saved.current = active;
  useEffect(() => {
    cache.current.clear();
    epoch.current++;
  }, [projectId, mainFile, roots, external]);
  useEffect(() => {
    if (saved.current.rootId === "primary")
      cache.current.delete(saved.current.file);
    epoch.current++;
  }, [revision]);
  useEffect(() => {
    if (!mainFile || !/\.(tex|ltx)$/.test(mainFile) || !roots.length) {
      setRead({ sources: [], readFor: external });
      return;
    }
    let cancelled = false;
    const files = cache.current;
    const start = epoch.current;
    readManuscript(mainFile, async (file) => {
      const cached = files.get(file);
      if (cached !== undefined) return cached;
      const text = await window
        .research!.readFile(projectId, file, "primary")
        .catch(() => null);
      const source = text === null ? null : { file, text };
      if (epoch.current === start) files.set(file, source);
      return source;
    }).then(
      (value) => {
        if (!cancelled) setRead({ sources: value, readFor: external });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, mainFile, roots, revision, external]);
  const includesActive =
    active.rootId === "primary" && sources.some((s) => s.file === active.file);
  const live = useMemo(
    () =>
      includesActive
        ? sources.map((s) =>
            s.file === active.file ? { file: s.file, text: active.text } : s,
          )
        : sources,
    [sources, includesActive, active.file, active.text],
  );
  // `settled`: the files reflect the latest outside change.
  const settled = readFor === external;
  return useMemo(
    () => ({ sources: live, includesActive, settled }),
    [live, includesActive, settled],
  );
}
