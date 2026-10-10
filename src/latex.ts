import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view";

/** Comments removed, line breaks kept so positions map to lines. */
export const withoutComments = (text: string) =>
  text.replace(/(^|[^\\])%.*$/gm, "$1");
/** Counts lines up to each increasing offset, so a scan stays linear. */
export function lineCounter(text: string) {
  let line = 1,
    counted = 0;
  return (offset: number) => {
    for (; counted < offset; counted++)
      if (text.charCodeAt(counted) === 10) line++;
    return line;
  };
}
/** The folder part of a project-relative path, with its trailing slash. */
export const directory = (file: string) =>
  file.slice(0, file.lastIndexOf("/") + 1);

export interface Problem {
  file: string;
  line: number;
  message: string;
  error: boolean;
}

/** latexmk runs with -file-line-error, so TeX prints errors as `./main.tex:8: message`. */
export const errorPattern = /^(.+?\.(?:tex|ltx|sty|cls|bib|dtx)):(\d+): (.*)$/m;

/**
 * Errors plus undefined citations and references from the last LaTeX pass:
 * earlier passes report citations that a later pass resolved, and latexmk's
 * summary repeats warnings without their files. A warning names only a line,
 * in whichever file TeX was reading, so the `(file.tex` and `)` entries of the
 * log are tracked as a stack. Paths are relative to the entry file.
 */
export function parseProblems(log: string, mainFile: string): Problem[] {
  const dir = directory(mainFile);
  const resolve = (file: string) =>
    file.startsWith("/") ? file : dir + file.replace(/^\.\//, "");
  const problems = new Map<string, Problem>();
  const files: string[] = [];
  const pass = log
    .split(/^Run number \d+ of rule '(?:pdf|xe|lua)?latex'/m)
    .at(-1)!
    .split(/^Latexmk: /m)[0];
  // TeX wraps log lines at 79 characters.
  for (const text of pass.replace(/^(.{79})\n/gm, "$1").split("\n")) {
    if (text.includes("==> Fatal error occurred")) continue;
    const error = errorPattern.exec(text);
    const missing =
      /Warning: (Citation|Reference) `(.+?)' on page \S+ undefined on input line (\d+)/.exec(
        text,
      );
    const problem = error
      ? {
          file: resolve(error[1]),
          line: +error[2],
          message: error[3],
          error: true,
        }
      : missing && {
          file: [...files].reverse().find(Boolean) || mainFile,
          line: +missing[3],
          message: `${missing[1]} '${missing[2]}' undefined`,
          error: false,
        };
    if (problem)
      problems.set(
        `${problem.file}:${problem.line}:${problem.message}`,
        problem,
      );
    else
      for (const [token, file] of text.matchAll(/\(([^\s()]*\.tex)?|\)/g))
        if (token === ")") files.pop();
        else files.push(file && !file.startsWith("/") ? resolve(file) : "");
  }
  return [...problems.values()];
}

export function countWords(text: string) {
  return (
    withoutComments(text)
      .replace(
        /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])*\$|\\\[[\s\S]*?\\\]|\\begin\{(equation|align|gather|multline)\*?\}[\s\S]*?\\end\{\1\*?\}/g,
        " ",
      )
      .replace(
        /\\(?:begin|end|label|\w*ref|\w*cite\w*|input|include\w*|usepackage|documentclass|bibliography\w*)\*?(?:\[[^\]]*\])*\{[^}]*\}/g,
        " ",
      )
      .replace(/\\[a-zA-Z@]+\*?/g, " ")
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  );
}

const levels = "part chapter section subsection subsubsection paragraph".split(
  " ",
);
export function outline(text: string) {
  const sections: { depth: number; title: string; line: number }[] = [];
  text.split("\n").forEach((source, index) => {
    const match =
      /^[^%]*?\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(
        source,
      );
    if (match)
      sections.push({
        depth: levels.indexOf(match[1]),
        title: match[2].replace(/\\[a-zA-Z]+\s*|[{}]/g, ""),
        line: index + 1,
      });
  });
  return sections;
}

// Citation commands: \cite, \citep*, \Citet, \parencites, \nocite and so on.
const citeName = String.raw`\\([a-zA-Z]*[cC]ite[a-zA-Z]*)\*?`;
/**
 * Style settings, \citetext, \newcites-style declarations and biblatex's
 * volume citations (whose first argument is a volume) are not plain key lists.
 */
export const takesKeys = (name: string) =>
  !/style|text$|^(?:new|declare)|vol/i.test(name);
/** A citation key list still open at the end of the text before the cursor. */
export const openCitation = new RegExp(
  citeName + String.raw`(?:\[[^\]]*\])*\{([^}]*)$`,
);
/**
 * Each key group of each citation in `text`, with its offset. Optional
 * [notes] and, for multi-citations, (global notes) are skipped.
 */
export function* citeGroups(text: string) {
  for (const match of text.matchAll(new RegExp(citeName, "g"))) {
    if (!takesKeys(match[1])) continue;
    const many = /cites$/i.test(match[1]);
    let at = match.index + match[0].length;
    for (;;) {
      while (/\s/.test(text[at] || "")) at++;
      if (text[at] === "[" || (many && text[at] === "(")) {
        const end = text.indexOf(text[at] === "[" ? "]" : ")", at);
        if (end < 0) break;
        at = end + 1;
        continue;
      }
      const end = text[at] === "{" ? text.indexOf("}", at) : -1;
      if (end < 0) break;
      yield {
        command: match.index,
        from: at + 1,
        keys: text.slice(at + 1, end),
      };
      at = end + 1;
      if (!many) break;
    }
  }
}

const environments =
  "abstract algorithm align align* center description document enumerate equation equation* figure figure* itemize minipage proof quote table table* tabular theorem verbatim".split(
    " ",
  );
export const latexCompletion =
  (citations: () => Completion[], projectLabels: () => string[] = () => []) =>
  async (context: CompletionContext) => {
    const cite = context.matchBefore(openCitation);
    if (cite)
      return takesKeys(openCitation.exec(cite.text)![1])
        ? {
            from: context.pos - /[^{,\s]*$/.exec(cite.text)![0].length,
            options: citations(),
            validFor: /^[^},\s]*$/,
          }
        : null;
    const match = context.matchBefore(
      /\\(\w*ref|begin)\*?(?:\[[^\]]*\])*\{[^}]*/,
    );
    if (!match) return null;
    const labels = match.text.startsWith("\\begin")
      ? environments
      : [
          ...new Set([
            ...Array.from(
              context.state.doc.toString().matchAll(/\\label\{([^}]+)\}/g),
              (label) => label[1],
            ),
            ...projectLabels(),
          ]),
        ];
    return {
      from: context.pos - /[^{,\s]*$/.exec(match.text)![0].length,
      options: labels.map((label) => ({ label })),
      validFor: /^[^},\s]*$/,
    };
  };

/** Hovering a key inside \cite{...} shows what `describe` says about it. */
export const citationHover = (describe: (key: string) => string) =>
  hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    for (const group of citeGroups(line.text)) {
      let from = line.from + group.from;
      for (const part of group.keys.split(",")) {
        const start = from + part.length - part.trimStart().length;
        const key = part.trim();
        from += part.length + 1;
        if (pos < start || pos > start + key.length) continue;
        return {
          pos: start,
          end: start + key.length,
          above: true,
          create: () => {
            const dom = document.createElement("div");
            dom.className = "cm-citation-card";
            dom.textContent = describe(key);
            return { dom };
          },
        };
      }
    }
    return null;
  });
