import { delimited } from "./bibliography.ts";
import { lineCounter, withoutComments } from "./latex.ts";
import type { ManuscriptFile } from "./latex-project.ts";

/** Facts read from the compiled PDF by the main process. */
export interface PdfReport {
  pages: number;
  author: string;
  title: string;
  notEmbedded: string[];
  type3: string[];
  /** Where the bibliography starts, and whether it opens that page. */
  references: { page: number; opensPage: boolean } | null;
}
export interface SubmissionCheck {
  status: "ok" | "warn" | "fail";
  message: string;
  file?: string;
  line?: number;
}

function* lines(sources: ManuscriptFile[]) {
  for (const { file, text } of sources) {
    let line = 0;
    for (const source of text.split("\n"))
      yield { file, line: ++line, text: withoutComments(source) };
  }
}

/** The first \bibliography, \printbibliography or thebibliography. */
export function referencesLocation(sources: ManuscriptFile[]) {
  for (const at of lines(sources))
    if (
      /\\(bibliography\s*\{|printbibliography\b|begin\s*\{thebibliography\})/.test(
        at.text,
      )
    )
      return { file: at.file, line: at.line };
  return null;
}

/** The class and options of the entry file's \documentclass. */
function documentClass(sources: ManuscriptFile[]) {
  const match = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(
    withoutComments(sources[0]?.text || ""),
  );
  return {
    name: match?.[2].trim() || "",
    options: (match?.[1] || "").split(",").map((o) => o.trim()),
  };
}

/** acmart hides authors and acknowledgments itself with `anonymous`. */
export const hidesAuthors = (sources: ManuscriptFile[]) => {
  const { name, options } = documentClass(sources);
  return name === "acmart" && options.includes("anonymous");
};

/**
 * Checks that commonly cause desk rejection: body length, fonts, and, for
 * double-blind review, anything that names the authors.
 */
export function submissionChecks(
  report: PdfReport,
  sources: ManuscriptFile[],
  { pageLimit, anonymous }: { pageLimit?: number; anonymous?: boolean },
): SubmissionCheck[] {
  const checks: SubmissionCheck[] = [];
  if (pageLimit) {
    const { references } = report;
    // A bibliography that opens a page leaves the body on the page before.
    const body = references
      ? references.page - (references.opensPage ? 1 : 0)
      : null;
    checks.push(
      body === null
        ? {
            status: "warn",
            message: `The references could not be located; the PDF has ${report.pages} pages (limit ${pageLimit} before references).`,
          }
        : body > pageLimit
          ? {
              status: "fail",
              message: `The body runs to page ${body}; the limit is ${pageLimit} pages before references.`,
            }
          : {
              status: "ok",
              message: `The body fits in ${body} of ${pageLimit} pages; references start on page ${references!.page}.`,
            },
    );
  }
  if (report.notEmbedded.length)
    checks.push({
      status: "fail",
      message: `Fonts not embedded: ${report.notEmbedded.join(", ")}.`,
    });
  if (report.type3.length)
    checks.push({
      status: "warn",
      message: `Type 3 bitmap fonts, often from figures: ${report.type3.join(", ")}.`,
    });
  if (!report.notEmbedded.length && !report.type3.length)
    checks.push({ status: "ok", message: "All fonts are embedded." });
  const hidden = hidesAuthors(sources);
  if (!anonymous && !hidden) return checks;
  const leaks: SubmissionCheck[] = [];
  if (report.author.trim())
    leaks.push({
      status: "fail",
      message: `PDF metadata names the author “${report.author.trim()}”.`,
    });
  // \author often spans lines, as in NeurIPS, ICLR and IEEE templates;
  // LNCS repeats the names in \authorrunning. \authorname and the like are
  // other commands.
  if (!hidden)
    for (const { file, text } of sources) {
      const body = withoutComments(text);
      const lineAt = lineCounter(body);
      for (const match of body.matchAll(
        /\\(author|authorrunning)(?![a-zA-Z@])\s*(?:\[[^\]]*\])?\s*/g,
      )) {
        const group = delimited(body, match.index! + match[0].length);
        if (group?.value.trim() && !/anonym/i.test(group.value))
          leaks.push({
            file,
            line: lineAt(match.index!),
            status: "fail",
            message: `\\${match[1]} names the authors.`,
          });
      }
    }
  for (const at of lines(sources)) {
    const where = { file: at.file, line: at.line };
    if (/\\thanks\s*\{/.test(at.text) && !hidden)
      leaks.push({
        ...where,
        status: "warn",
        message: "\\thanks can identify the authors.",
      });
    if (
      /\\(?:section|subsection|subsubsection|paragraph)\*?\s*\{\s*acknowledg/i.test(
        at.text,
      ) ||
      (/\\begin\s*\{(?:acks?|acknowledge?ments?)\}/i.test(at.text) && !hidden)
    )
      leaks.push({
        ...where,
        status: "warn",
        message: "Acknowledgments usually wait until the camera-ready version.",
      });
    const link =
      /https?:\/\/(?:www\.)?(?:github|gitlab|huggingface)\.co(?:m)?\/[\w.-]+/i.exec(
        at.text,
      );
    if (link)
      leaks.push({
        ...where,
        status: "warn",
        message: `${link[0]} may identify the authors; use an anonymized link.`,
      });
  }
  checks.push(
    ...(leaks.length
      ? leaks
      : [
          {
            status: "ok" as const,
            message:
              "No author names, acknowledgments or personal links were found.",
          },
        ]),
  );
  return checks;
}
