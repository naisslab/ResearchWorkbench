const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const core = require("./core.cjs");

async function resolveProjectReference(project, reference, rootId = "primary") {
  if (typeof reference !== "string" || !reference || reference.length > 8192)
    throw new Error("Invalid file link.");
  let line;
  const location = reference.match(/(?:#L|:)(\d+)(?::\d+|(?:-L?\d+)?)$/);
  if (location) {
    line = Math.max(1, Number(location[1]));
    reference = reference.slice(0, location.index);
  }
  let file;
  if (/^file:/i.test(reference)) file = fileURLToPath(reference);
  else {
    if (/^[a-z][a-z\d+.-]*:/i.test(reference))
      throw new Error("Only project file links can be opened here.");
    file = decodeURIComponent(reference);
  }
  if (/[\0\r\n]/.test(file)) throw new Error("Invalid file link.");
  const roots = [
    ...(project.folder ? [{ id: "primary", folder: project.folder }] : []),
    ...(project.localFolders || []),
  ].sort((a, b) => b.folder.length - a.folder.length);
  let selected, relative;
  if (path.isAbsolute(file)) {
    for (const root of roots) {
      // Accept paths written using either the attached folder or its real path.
      const canonical = await fs.realpath(root.folder).catch(() => null);
      for (const base of [root.folder, canonical].filter(Boolean)) {
        const candidate = path.relative(base, file);
        if (
          candidate &&
          candidate !== ".." &&
          !candidate.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(candidate)
        ) {
          selected = root;
          relative = candidate;
          break;
        }
      }
      if (selected) break;
    }
  } else {
    selected = roots.find((root) => root.id === rootId);
    relative = file;
  }
  if (!selected || !relative)
    throw new Error("This file is outside the project's attached folders.");
  const target = await core.safeFile(selected.folder, relative);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("This link does not point to a file.");
  const pdf = path.extname(target).toLowerCase() === ".pdf";
  if (!pdf && !core.isTextFile(target))
    throw new Error("This file cannot be opened in the editor.");
  if (stat.size > (pdf ? 64 : 2) * 1024 * 1024)
    throw new Error(
      pdf
        ? "PDF is too large (maximum 64 MB)."
        : "File is too large to edit (maximum 2 MB).",
    );
  return {
    kind: pdf ? "pdf" : "text",
    target,
    file: relative,
    rootId: selected.id,
    line,
  };
}
module.exports = { resolveProjectReference };
