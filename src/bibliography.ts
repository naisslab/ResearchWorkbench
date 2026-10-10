import type { Completion } from "@codemirror/autocomplete";
import {
  citeGroups,
  lineCounter,
  withoutComments,
  type Problem,
} from "./latex.ts";
import type { ManuscriptFile } from "./latex-project.ts";

export interface BibEntry {
  key: string;
  type: string;
  file: string;
  line: number;
  fields: Record<string, string>;
  /** Fields written without braces or quotes, such as `month = jan`. */
  bare: string[];
}

/** Reads `{...}` or `"..."` starting at `at`, honoring nested braces. */
export function delimited(text: string, at: number) {
  const quoted = text[at] === '"';
  let depth = quoted ? 0 : 1;
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0 && !quoted)
      return { value: text.slice(at + 1, i), end: i + 1 };
    else if (c === '"' && quoted && depth === 0)
      return { value: text.slice(at + 1, i), end: i + 1 };
  }
  return null;
}

export const plainField = (value = "") =>
  value
    .replace(/\\[a-zA-Z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Entries of one .bib file; @string, @comment and @preamble are skipped. */
export function parseBibliography(text: string, file: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const start = /@([a-zA-Z]+)\s*([{(])\s*([^,\s{}()]+)\s*,/g;
  let match: RegExpExecArray | null;
  // Large exports have thousands of entries, so lines are counted once.
  const lineAt = lineCounter(text);
  while ((match = start.exec(text))) {
    const type = match[1].toLowerCase();
    if (["string", "comment", "preamble"].includes(type)) continue;
    const fields: Record<string, string> = {};
    const bare: string[] = [];
    let at = start.lastIndex;
    const field = /\s*([a-zA-Z][\w-]*)\s*=\s*/y;
    for (;;) {
      field.lastIndex = at;
      const name = field.exec(text);
      if (!name) break;
      at = field.lastIndex;
      let value: string;
      if (text[at] === "{" || text[at] === '"') {
        const read = delimited(text, at);
        if (!read) break;
        value = read.value;
        at = read.end;
      } else {
        const unquoted = /[^,}\n]*/y;
        unquoted.lastIndex = at;
        value = unquoted.exec(text)![0].trim();
        at = unquoted.lastIndex;
        bare.push(name[1].toLowerCase());
      }
      fields[name[1].toLowerCase()] = value;
      const comma = /\s*,/y;
      comma.lastIndex = at;
      if (!comma.exec(text)) break;
      at = comma.lastIndex;
    }
    entries.push({
      key: match[3],
      type,
      file,
      line: lineAt(match.index),
      fields,
      bare,
    });
    start.lastIndex = Math.max(at, start.lastIndex);
  }
  return entries;
}

/** "Lewis, Patrick and Perez, Ethan" → "Lewis, Perez"; long lists end in "et al.". */
export function authorSurnames(authors = "") {
  const names = plainField(authors)
    .split(/\s+and\s+/)
    .filter(Boolean)
    .map((name) =>
      name.includes(",") ? name.split(",")[0].trim() : name.split(" ").pop()!,
    );
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} et al.`
    : names.join(", ");
}

export const describeEntry = (entry: BibEntry) =>
  [
    plainField(entry.fields.title),
    authorSurnames(entry.fields.author),
    [
      plainField(
        entry.fields.booktitle ||
          entry.fields.journal ||
          entry.fields.publisher,
      ),
      entry.fields.year,
    ]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

export const foldKey = (key: string) => key.toLowerCase();

// Per-file results: while typing, only the edited file gets a new object.
function perFile<T>(compute: (source: ManuscriptFile) => T) {
  const cache = new WeakMap<ManuscriptFile, T>();
  return (source: ManuscriptFile) => {
    if (!cache.has(source)) cache.set(source, compute(source));
    return cache.get(source)!;
  };
}
const citedIn = perFile(({ text }) => {
  const body = withoutComments(text);
  const lineAt = lineCounter(body);
  const found: { key: string; line: number }[] = [];
  for (const group of citeGroups(body))
    for (const key of group.keys.split(",").map((k) => k.trim()))
      // Macro parameters such as #1 are not keys.
      if (key && !/[#\\\s{}]/.test(key))
        found.push({ key, line: lineAt(group.command) });
  return found;
});
/**
 * Every key cited in the manuscript, with where it first appears. Covers
 * natbib and biblatex forms such as \Citet, \citep[see][]{a,b} and
 * \parencites{a}{b}.
 */
export function citations(sources: ManuscriptFile[]) {
  const cited = new Map<string, { file: string; line: number }>();
  for (const source of sources)
    for (const { key, line } of citedIn(source))
      if (!cited.has(key)) cited.set(key, { file: source.file, line });
  return cited;
}

// Keys defined by \bibitem, as with an inlined .bbl.
const bibitemsIn = perFile(
  ({ text }) =>
    new Set(
      Array.from(
        withoutComments(text).matchAll(
          /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
        ),
        ([, key]) => key.trim(),
      ),
    ),
);

/**
 * Duplicate keys, citations missing from every .bib file, and entries that are
 * never cited. `\nocite{*}` cites everything. Keys the build already reports
 * as undefined are left to the build log.
 */
/** A bibliography that could not be loaded, and where to look. */
export interface Unreadable {
  file: string;
  line?: number;
  message: string;
}
export function bibliographyProblems(
  entries: BibEntry[] | null,
  sources: ManuscriptFile[],
  reported: Problem[] = [],
  unreadable: Unreadable[] = [],
): Problem[] {
  // Still loading: no warnings that would vanish a moment later.
  if (!entries) return [];
  const problems: Problem[] = unreadable.map(({ file, line, message }) => ({
    file,
    line: line ?? 1,
    message,
    error: false,
  }));
  // BibTeX looks keys up regardless of case.
  const first = new Map<string, BibEntry>();
  for (const entry of entries) {
    const earlier = first.get(foldKey(entry.key));
    if (earlier)
      problems.push({
        file: entry.file,
        line: entry.line,
        message: `Duplicate BibTeX key '${entry.key}' (also ${earlier.file}:${earlier.line})`,
        error: false,
      });
    else first.set(foldKey(entry.key), entry);
  }
  const inline = new Set(
    sources.flatMap((s) => [...bibitemsIn(s)]).map(foldKey),
  );
  // Without every .bib, or with none and no \bibitem, citations cannot be
  // checked against the bibliography.
  if (unreadable.length || !sources.length || (!entries.length && !inline.size))
    return problems;
  const cited = citations(sources);
  const citedKeys = new Set([...cited.keys()].map(foldKey));
  const logged = new Set(
    reported.map((p) =>
      foldKey(/^Citation '(.+)' undefined$/.exec(p.message)?.[1] || ""),
    ),
  );
  for (const [key, at] of cited) {
    const folded = foldKey(key);
    if (
      key !== "*" &&
      !first.has(folded) &&
      !inline.has(folded) &&
      !logged.has(folded)
    )
      problems.push({
        ...at,
        message: `Citation '${key}' is not in any .bib file`,
        error: false,
      });
  }
  if (!cited.has("*")) {
    const unused = [...first.values()].filter(
      (e) => !citedKeys.has(foldKey(e.key)),
    );
    if (unused.length)
      problems.push({
        file: unused[0].file,
        line: unused[0].line,
        message: `${unused.length} BibTeX ${unused.length === 1 ? "entry is" : "entries are"} never cited: ${unused
          .slice(0, 4)
          .map((e) => e.key)
          .join(", ")}${unused.length > 4 ? ", …" : ""}`,
        error: false,
      });
  }
  return problems;
}

const ascii = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const stopWords = new Set(
  "a an the of on for in to and with towards toward via from by is are".split(
    " ",
  ),
);

/**
 * A readable key such as `lewis2020retrieval`, unique among `existing`, which
 * holds keys folded with `foldKey`.
 */
export function referenceKey(
  fields: Record<string, string>,
  existing: Set<string>,
) {
  const surname = ascii(authorSurnames(fields.author).split(/,| /)[0] || "");
  const word =
    plainField(fields.title)
      .split(/[\s:-]+/)
      .map(ascii)
      .find((w) => w && !stopWords.has(w)) || "";
  const base = `${surname || "ref"}${fields.year || ""}${word}` || "ref";
  let key = base;
  for (let i = 0; existing.has(foldKey(key)); i++)
    key = base + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? i : "");
  return key;
}

const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
// Crossref escapes text for HTML; in LaTeX a bare & ends a table cell, so it
// is escaped outside fields that hold addresses.
function texSafe(name: string, value: string) {
  const text = value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (match, decimal, hex, named) =>
      decimal || hex
        ? String.fromCodePoint(parseInt(decimal || hex, decimal ? 10 : 16))
        : (entities[named.toLowerCase()] ?? match),
  );
  return ["url", "doi", "eprint", "howpublished"].includes(name)
    ? text
    : text.replace(/(?<!\\)&/g, "\\&");
}

/**
 * Gives the entry the key `name` derives from its fields and drops fields that
 * only add noise to a .bib.
 */
export function rekeyEntry(
  bibtex: string,
  name: (fields: Record<string, string>) => string,
) {
  const [entry] = parseBibliography(bibtex, "");
  if (!entry) throw new Error("The service returned no BibTeX entry.");
  const key = name(entry.fields);
  const bare = new Set(entry.bare);
  const fields = Object.entries(entry.fields)
    .filter(([name]) => !["keywords", "copyright", "abstract"].includes(name))
    .map(([name, value]): [string, string] => {
      // Services send month names, which BibTeX knows only as jan..dec.
      const month = name === "month" && /^([a-z]{3})[a-z]*\.?$/i.exec(value);
      if (month && months.includes(month[1].toLowerCase())) {
        bare.add(name);
        return [name, month[1].toLowerCase()];
      }
      return [name, texSafe(name, value)];
    });
  const width = Math.max(...fields.map(([name]) => name.length));
  return `@${entry.type}{${key},\n${fields
    .map(
      ([name, value]) =>
        `  ${name.padEnd(width)} = ${bare.has(name) ? value : `{${value}}`}`,
    )
    .join(",\n")}\n}\n`;
}

/** `bibtex` appended to a .bib's text, one blank line after what is there. */
export const appendEntry = (text: string, bibtex: string) =>
  text +
  (!text || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n") +
  bibtex;

// Built once per bibliography; descriptions are rendered when shown.
const options = new WeakMap<BibEntry[], Completion[]>();
export function citationOptions(entries: BibEntry[]) {
  if (!options.has(entries))
    options.set(
      entries,
      entries.map((entry) => ({
        label: entry.key,
        detail: entry.fields.year,
        info: () => {
          const dom = document.createElement("div");
          dom.textContent = describeEntry(entry);
          return dom;
        },
      })),
    );
  return options.get(entries)!;
}
