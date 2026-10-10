import { useEffect, useState } from "react";
import type { ProjectFileRoot } from "./types";
import {
  parseBibliography,
  type BibEntry,
  type Unreadable,
} from "./bibliography.ts";
import { directory, lineCounter, withoutComments } from "./latex.ts";
import { normalize, type ManuscriptFile } from "./latex-project.ts";

// An absolute path, or more .. than folders, points outside the project.
function leavesFolder(file: string) {
  if (file.startsWith("/")) return true;
  let depth = 0;
  for (const part of file.split("/"))
    if (part === "..") {
      if (--depth < 0) return true;
    } else if (part && part !== ".") depth++;
  return false;
}
interface BibName {
  name: string;
  file: string;
  line: number;
}
// The .bib names one file gives, cached so typing rescans only that file.
const named = new WeakMap<ManuscriptFile, BibName[]>();
function bibNames(source: ManuscriptFile) {
  let names = named.get(source);
  if (!names) {
    names = [];
    const body = withoutComments(source.text);
    const lineAt = lineCounter(body);
    for (const match of body.matchAll(
      /\\(bibliography|addbibresource)\s*(?:\[[^\]]*\])?\{([^}]*)\}/g,
    ))
      for (const name of match[2].split(",").map((n) => n.trim()))
        if (name)
          names.push({
            name:
              match[1] === "bibliography" && !name.endsWith(".bib")
                ? `${name}.bib`
                : name,
            file: source.file,
            line: lineAt(match.index),
          });
    named.set(source, names);
  }
  return names;
}

/**
 * The .bib files the manuscript names with \bibliography or \addbibresource,
 * relative to the entry file, or every .bib in the project folder when it
 * names none. `missing` holds named files outside the project's file list,
 * such as ../shared/refs.bib or an absolute Zotero export.
 */
export function bibliographyFiles(
  sources: ManuscriptFile[],
  mainFile: string,
  root: ProjectFileRoot | undefined,
) {
  const folder = directory(mainFile);
  const listed = new Set(root?.files || []);
  const names = sources.flatMap(bibNames);
  if (!names.length)
    return {
      files: [...listed].filter((file) => file.endsWith(".bib")),
      missing: [] as Unreadable[],
    };
  const files = new Set<string>();
  const missing: Unreadable[] = [];
  for (const { name, file, line } of names) {
    const path = normalize(folder + name);
    if (!leavesFolder(folder + name) && listed.has(path)) files.add(path);
    else
      missing.push({
        file,
        line,
        message: `${name} is not among the project's files, so citations are not checked`,
      });
  }
  return { files: [...files], missing };
}

/**
 * Entries of the manuscript's .bib files, re-read after .bib saves and file
 * changes, and the files that could not be read; null until the first read
 * finishes.
 */
export function useBibliography(
  projectId: string,
  files: string[],
  roots: ProjectFileRoot[],
  revision: number,
) {
  const [loaded, setLoaded] = useState<{
    entries: BibEntry[];
    unreadable: Unreadable[];
  } | null>(null);
  const key = files.join("\n");
  useEffect(() => {
    let cancelled = false;
    const unreadable: Unreadable[] = [];
    Promise.all(
      files.map((file) =>
        window
          .research!.readFile(projectId, file, "primary")
          .then((text) => parseBibliography(text, file))
          .catch((error: Error) => {
            unreadable.push({
              file,
              message: `${file} could not be read, so citations are not checked: ${error.message}`,
            });
            return [];
          }),
      ),
    ).then((lists) => {
      if (!cancelled) setLoaded({ entries: lists.flat(), unreadable });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, key, roots, revision]);
  return loaded;
}
