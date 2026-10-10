import { countWords, directory, outline, withoutComments } from "./latex.ts";

/**
 * A manuscript split across files, read from its entry file through \input,
 * \include, \subfile, \import and \subimport. Paths are relative to the
 * project folder, like the entry file.
 */
export interface ManuscriptFile {
  file: string;
  text: string;
}
export interface ManuscriptSection {
  depth: number;
  title: string;
  file: string;
  line: number;
}

const includePattern =
  /\\(input|include|subfile|import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)\*?\s*\{([^}]*)\}(?:\s*\{([^}]*)\})?/g;
/** Resolves `.` and `..` in a project-relative path. */
export function normalize(file: string) {
  const parts: string[] = [];
  for (const part of file.split("/"))
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  return parts.join("/");
}

/** The files a line pulls in, in order. `\import` paths start at the entry folder. */
export function includes(line: string, file: string, mainFile: string) {
  const targets: string[] = [];
  for (const [, command, first, second] of withoutComments(line).matchAll(
    includePattern,
  )) {
    const relative = command.startsWith("sub");
    // Only the import family names a folder and a file.
    const twoPart = /import|from$/.test(command);
    if (twoPart && second === undefined) continue;
    const [folder, name] = twoPart
      ? [first.trim(), second.trim()]
      : ["", first.trim()];
    // Absolute paths lie outside the project folder.
    if ((folder || name).startsWith("/")) continue;
    const base = relative ? directory(file) : directory(mainFile);
    const target = normalize(
      base + (folder && !folder.endsWith("/") ? folder + "/" : folder) + name,
    );
    if (!target) continue;
    targets.push(/\.[a-z]+$/i.test(target) ? target : target + ".tex");
  }
  return targets;
}

/**
 * What one file contributes, computed once per file object: while typing,
 * only the edited file gets a new object, so the others are not rescanned.
 */
interface FileFacts {
  sections: { depth: number; title: string; line: number }[];
  labels: { label: string; line: number }[];
  words: number;
  /** Lines that may include files; resolving them depends on the entry file. */
  includeLines: { line: number; text: string }[];
  resolved: Map<string, { line: number; targets: string[] }[]>;
}
const facts = new WeakMap<ManuscriptFile, FileFacts>();
function factsOf(source: ManuscriptFile) {
  let value = facts.get(source);
  if (value) return value;
  value = {
    sections: outline(source.text),
    labels: [],
    words: /\.(tex|ltx)$/.test(source.file) ? countWords(source.text) : 0,
    includeLines: [],
    resolved: new Map(),
  };
  const { labels, includeLines } = value;
  withoutComments(source.text)
    .split("\n")
    .forEach((text, index) => {
      if (/\\(?:sub)?(?:input|include|import|subfile)/.test(text))
        includeLines.push({ line: index + 1, text });
      for (const [, label] of text.matchAll(/\\label\{([^}]+)\}/g))
        labels.push({ label, line: index + 1 });
    });
  facts.set(source, value);
  return value;
}
function includesOf(source: ManuscriptFile, mainFile: string) {
  const { includeLines, resolved } = factsOf(source);
  let value = resolved.get(mainFile);
  if (!value) {
    value = includeLines
      .map(({ line, text }) => ({
        line,
        targets: includes(text, source.file, mainFile),
      }))
      .filter(({ targets }) => targets.length);
    resolved.set(mainFile, value);
  }
  return value;
}

/**
 * Reads the entry file and everything it includes, at most `limit` files,
 * one level of includes at a time. `read` may return the same object for an
 * unchanged file, which keeps its cached facts.
 */
export async function readManuscript(
  mainFile: string,
  read: (file: string) => Promise<ManuscriptFile | null>,
  limit = 200,
) {
  const sources: ManuscriptFile[] = [];
  const seen = new Set([normalize(mainFile)]);
  let level = [...seen];
  while (level.length && sources.length < limit) {
    level = level.slice(0, limit - sources.length);
    const found = await Promise.all(level.map(read));
    const next: string[] = [];
    level.forEach((_, index) => {
      const source = found[index];
      if (!source) return;
      sources.push(source);
      for (const { targets } of includesOf(source, mainFile))
        for (const target of targets)
          if (!seen.has(target)) {
            seen.add(target);
            next.push(target);
          }
    });
    level = next;
  }
  return sources;
}

/** Sections in reading order, following each include where it appears. */
export function manuscriptOutline(sources: ManuscriptFile[], mainFile: string) {
  const byFile = new Map(sources.map((s) => [s.file, s]));
  const sections: ManuscriptSection[] = [];
  const visited = new Set<string>();
  const walk = (file: string) => {
    const source = byFile.get(file);
    if (!source || visited.has(file)) return;
    visited.add(file);
    const headings = factsOf(source).sections;
    // Headings and includes interleave by line; an include follows a heading
    // on the same line, as TeX reads it.
    let next = 0;
    for (const include of includesOf(source, mainFile)) {
      for (
        ;
        next < headings.length && headings[next].line <= include.line;
        next++
      )
        sections.push({ ...headings[next], file });
      include.targets.forEach(walk);
    }
    for (; next < headings.length; next++)
      sections.push({ ...headings[next], file });
  };
  walk(normalize(mainFile));
  return sections;
}

/** Every \label in the manuscript, with where it is first defined. */
export function manuscriptLabels(sources: ManuscriptFile[]) {
  const labels = new Map<string, { file: string; line: number }>();
  for (const source of sources)
    for (const { label, line } of factsOf(source).labels)
      if (!labels.has(label)) labels.set(label, { file: source.file, line });
  return labels;
}

export const manuscriptWords = (sources: ManuscriptFile[]) =>
  sources.reduce((total, source) => total + factsOf(source).words, 0);
