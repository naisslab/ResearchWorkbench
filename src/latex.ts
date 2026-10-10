import type { CompletionContext } from "@codemirror/autocomplete";
import type { ProjectFileRoot } from "./types";

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
  const dir = mainFile.slice(0, mainFile.lastIndexOf("/") + 1);
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
    text
      .replace(/(^|[^\\])%.*/gm, "$1")
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

const citations = new Map<string, Promise<string[]>>();
/** BibTeX keys from the project's .bib files, read once per app session. */
export function citationKeys(projectId: string, roots: ProjectFileRoot[]) {
  if (!citations.has(projectId) && roots.length)
    citations.set(
      projectId,
      Promise.all(
        roots.flatMap((root) =>
          root.files
            .filter((file) => file.endsWith(".bib"))
            .map((file) =>
              window.research!.readFile(projectId, file, root.id).then(
                (bib) =>
                  Array.from(
                    bib.matchAll(
                      /@(?!string|comment|preamble)\w+\s*[{(]\s*([^,\s]+)\s*,/gi,
                    ),
                    (match) => match[1],
                  ),
                () => [],
              ),
            ),
        ),
      ).then((keys) => [...new Set(keys.flat())]),
    );
  return citations.get(projectId) ?? Promise.resolve([]);
}
export const forgetCitations = (projectId: string) =>
  citations.delete(projectId);

const environments =
  "abstract algorithm align align* center description document enumerate equation equation* figure figure* itemize minipage proof quote table table* tabular theorem verbatim".split(
    " ",
  );
export const latexCompletion =
  (keys: () => Promise<string[]>) => async (context: CompletionContext) => {
    const match = context.matchBefore(
      /\\(\w*cite\w*|\w*ref|begin)\*?(?:\[[^\]]*\])*\{[^}]*/,
    );
    if (!match) return null;
    const command = match.text.slice(1, match.text.search(/[*[{]/));
    const labels =
      command === "begin"
        ? environments
        : command.endsWith("ref")
          ? [
              ...new Set(
                Array.from(
                  context.state.doc.toString().matchAll(/\\label\{([^}]+)\}/g),
                  (label) => label[1],
                ),
              ),
            ]
          : await keys();
    return {
      from: context.pos - /[^{,\s]*$/.exec(match.text)![0].length,
      options: labels.map((label) => ({ label })),
      validFor: /^[^},\s]*$/,
    };
  };
