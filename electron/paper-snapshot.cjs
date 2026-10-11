const fs = require("node:fs/promises");
const path = require("node:path");
const { safeFile, pdfPath, MAX_PDF_BYTES } = require("./core.cjs");

const warnings = (log) =>
  [
    ...new Set(
      (log || "")
        .split(/\r?\n/)
        .filter((line) =>
          /Warning|Overfull|Underfull|Undefined control sequence|^!/.test(line),
        )
        .map((line) => line.trim()),
    ),
  ].slice(0, 100);

// Only the configured manuscript's generated PDF is eligible. Never follow
// a generated-folder symlink outside the attached project.
async function paperSnapshot(project) {
  if (!project?.folder || !project.mainFile)
    return { note: "No manuscript is configured." };
  try {
    const folder = await fs.realpath(project.folder);
    const main = await safeFile(folder, project.mainFile);
    const pdf = await safeFile(folder, path.relative(folder, pdfPath(main)));
    const before = await fs.stat(pdf);
    if (before.size > MAX_PDF_BYTES)
      throw new Error("PDF exceeds the 64 MB review limit.");
    const bytes = await fs.readFile(pdf);
    const after = await fs.stat(pdf);
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
      throw new Error(
        "PDF changed during capture; compile again to verify it.",
      );
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("The build output is not a PDF.");
    let log = "";
    try {
      const logPath = await safeFile(
        folder,
        path.relative(folder, pdf.replace(/\.pdf$/, ".log")),
      );
      if ((await fs.stat(logPath)).size <= 2 * 1024 * 1024)
        log = await fs.readFile(logPath, "utf8");
    } catch {
      /* Missing logs do not invalidate the captured PDF. */
    }
    return {
      bytes,
      warnings: warnings(log),
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      note:
        error.code === "ENOENT"
          ? "No compiled PDF was available."
          : error.message,
    };
  }
}
module.exports = { paperSnapshot, warnings };
