// Main-process agent tools that read workspace state, PDF annotations and the
// search index. Results are compact JSON for the model.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("./core.cjs");

const clip = (text, max) =>
  typeof text === "string" && text.length > max
    ? text.slice(0, max) + "…"
    : text || "";

/** What the project details page shows, for `get_project`. */
function projectDetails(state, p) {
  return {
    name: p.name,
    researchQuestion: p.summary || "",
    stage: p.stage,
    targetVenue: p.venue || "",
    pageLimit: p.pageLimit ?? null,
    anonymousReview: !!p.anonymousReview,
    entryFile: p.mainFile || null,
    latexEngine: p.latexEngine || "automatic",
    milestones: (p.deadlines || []).map(({ label, date, kind }) => ({
      label,
      date,
      kind,
    })),
    conferenceDates: (state.trackedDeadlines || [])
      .filter(
        (d) => d.projectId === p.id || (d.projectIds || []).includes(p.id),
      )
      .map(({ label, subtitle, kind, time, timezone, status }) => ({
        label,
        subtitle,
        kind,
        time,
        timezone,
        status,
      })),
    today: new Date().toISOString().slice(0, 10),
  };
}

/**
 * The project's PDF annotations, newest PDF version first. Annotations on the
 * current compiled PDF are mapped to their source line through SyncTeX, as
 * "Ask Agent to address this" does.
 */
async function listFeedback(store, p, status, environment) {
  const records = (await store.records(p.id)).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const compiled = await currentCompiled(p);
  const feedback = [];
  for (const record of records) {
    const boxes =
      compiled && compiled.hash === record.documentHash
        ? await pageBoxes(compiled.bytes)
        : null;
    for (const item of record.annotations) {
      if (status === "open" && item.resolved) continue;
      if (feedback.length >= 100) break;
      const reply = record.agentReplies?.[item.id];
      feedback.push({
        documentKey: record.key,
        id: item.id,
        document: record.name,
        version: record.updatedAt,
        current: !!boxes,
        page: item.page,
        kind: item.kind,
        quote: clip(item.quote, 1500),
        comment: clip(item.comment, 1500),
        status: item.resolved ? "resolved" : "open",
        ...(reply && { agentReply: reply.note }),
        ...(boxes && {
          source: await sourceOf(p, item, boxes[item.page - 1], environment),
        }),
      });
    }
  }
  return { feedback };
}
async function currentCompiled(p) {
  try {
    const file = core.pdfPath(await core.safeFile(p.folder, p.mainFile));
    const bytes = await fs.readFile(file);
    return {
      bytes,
      hash: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    return null;
  }
}
async function pageBoxes(bytes) {
  try {
    const { PDFDocument } = require("pdf-lib");
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    return document.getPages().map((page) => page.getCropBox());
  } catch {
    return null;
  }
}
// Annotation points are PDF user-space coordinates; SyncTeX measures from the
// page's top-left corner.
async function sourceOf(p, item, box, environment) {
  const point = item.position || item.rects?.[0] || item.points?.[0];
  if (!point || !box) return null;
  const x = point.x - box.x;
  const y = box.y + box.height - point.y;
  if (x < 0 || y < 0) return null;
  const found = await core
    .synctexInverse(p, item.page, x, y, environment)
    .catch(() => null);
  return found && { file: found.file, line: found.line };
}

/** Search hits for the model; paths are relative to the project folder. */
function searchResults(packet) {
  return {
    results: packet.results.slice(0, 30).map((hit) => ({
      kind: hit.kind,
      title: clip(hit.title, 200),
      snippet: clip(hit.snippet, 400),
      ...(hit.file && { file: hit.file }),
      ...(hit.line && { line: hit.line }),
      ...(hit.page && { page: hit.page }),
    })),
    ...(packet.results.length > 30 && {
      note: `${packet.results.length - 30} more results; refine the query.`,
    }),
    warnings: packet.warnings.slice(0, 5),
  };
}

/** Problems from a build log, relative to the project folder. */
async function buildResult(p, result, skippedConfig) {
  const { parseProblems } = await import("./latex-log.mjs");
  const problems = parseProblems(result.log, p.mainFile).slice(0, 50);
  return {
    ok: result.ok,
    // The build reports the PDF under the folder's resolved path.
    pdf: result.pdf
      ? path.relative(
          await fs.realpath(p.folder).catch(() => p.folder),
          result.pdf,
        )
      : null,
    problems,
    ...(skippedConfig && {
      note: "The project's latexmkrc is not trusted, so this build skipped it. The user can trust it by compiling from the workbench.",
    }),
    ...(!result.ok && !problems.length && { log: result.log.slice(-4000) }),
  };
}

/**
 * The agent's own build: the workbench's build slot, output and engine, but a
 * latexmkrc runs only if the user already trusts it, since no one is asked
 * while the agent works. `events` lets the workbench show the build.
 */
async function compileForAgent(
  p,
  { builds, trusted, output, events, environment, compile = core.compile },
  signal,
) {
  if (!p.folder || !p.mainFile)
    throw new Error(
      "Set the project folder and LaTeX entry file in project details first.",
    );
  if (builds.has(p.id))
    throw new Error(
      "This project is already compiling. Try again after it finishes.",
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  builds.set(p.id, controller);
  events({ running: true });
  let skipped = false;
  let result;
  try {
    result = await compile(
      p,
      output,
      environment,
      controller.signal,
      async (config) => {
        skipped = !(await trusted(config));
        return !skipped;
      },
    );
    return await buildResult(p, result, skipped);
  } finally {
    output.flush?.();
    builds.delete(p.id);
    signal.removeEventListener("abort", abort);
    events({
      running: false,
      ...(result && { ok: result.ok, log: result.log, pdf: result.pdf }),
    });
  }
}

module.exports = {
  projectDetails,
  listFeedback,
  searchResults,
  buildResult,
  compileForAgent,
};
