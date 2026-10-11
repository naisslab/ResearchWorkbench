// LaTeX log parsing shared by the Build log and the agent's compile tool.

/** The folder part of a project-relative path, with its trailing slash. */
export const directory = (file) => file.slice(0, file.lastIndexOf("/") + 1);

/** latexmk runs with -file-line-error, so TeX prints errors as `./main.tex:8: message`. */
export const errorPattern = /^(.+?\.(?:tex|ltx|sty|cls|bib|dtx)):(\d+): (.*)$/m;

/**
 * Errors plus undefined citations and references from the last LaTeX pass:
 * earlier passes report citations that a later pass resolved, and latexmk's
 * summary repeats warnings without their files. A warning names only a line,
 * in whichever file TeX was reading, so the `(file.tex` and `)` entries of the
 * log are tracked as a stack. Paths are relative to the entry file.
 */
export function parseProblems(log, mainFile) {
  const dir = directory(mainFile);
  const resolve = (file) =>
    file.startsWith("/") ? file : dir + file.replace(/^\.\//, "");
  const problems = new Map();
  const files = [];
  const pass = log
    .split(/^Run number \d+ of rule '(?:pdf|xe|lua)?latex'/m)
    .at(-1)
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
