const { parentPort } = require("node:worker_threads");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("./core.cjs");
const normalize = (text) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
let generation = 0;
let pdfjs;
const cache = new Map();
let cacheBytes = 0;
async function pdfPages(file) {
  const stat = await fs.stat(file);
  if (stat.size > 64 * 1024 * 1024) throw new Error("PDF exceeds 64 MB");
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  if (cache.get(file)?.stamp === stamp) return cache.get(file).value;
  pdfjs ||= await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = await fs.readFile(file);
  const version = crypto.createHash("sha256").update(bytes).digest("hex");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await task.promise;
  try {
    const pages = [];
    for (let page = 1; page <= Math.min(document.numPages, 1000); page++) {
      const loaded = await document.getPage(page);
      const content = await loaded.getTextContent();
      let text = "";
      const spans = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const str = normalize(item.str);
        const separator =
          /[\u3000-\u9fff]$/.test(text) && /^[\u3000-\u9fff]/.test(str)
            ? ""
            : " ";
        if (text && !text.endsWith(" ")) text += separator;
        const start = text.length;
        text += str;
        spans.push({
          start,
          end: text.length,
          x: item.transform[4] - loaded.view[0],
          y: loaded.view[3] - item.transform[5],
        });
        if (item.hasEOL) {
          if (text.endsWith("-")) text = text.slice(0, -1);
          else text += " ";
        }
      }
      pages.push({ page, text, spans });
      loaded.cleanup();
    }
    const value = { pages, version, truncated: document.numPages > 1000 };
    const bytes = pages.reduce(
      (total, page) => total + page.text.length * 2 + page.spans.length * 64,
      0,
    );
    cacheBytes -= cache.get(file)?.bytes || 0;
    cache.delete(file);
    if (bytes <= 32 * 1024 * 1024) {
      cache.set(file, { stamp, value, bytes });
      cacheBytes += bytes;
    }
    while (cacheBytes > 32 * 1024 * 1024 || cache.size > 60) {
      const key = cache.keys().next().value;
      cacheBytes -= cache.get(key).bytes;
      cache.delete(key);
    }
    return value;
  } finally {
    await task.destroy();
  }
}
async function* files(root, warnings) {
  const queue = [{ dir: root, depth: 0 }];
  let budget = 20000,
    count = 0;
  while (queue.length && budget > 0 && count < 2000) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      warnings.add(`Folder unavailable: ${dir}`);
      continue;
    }
    for (const entry of entries) {
      if (--budget < 0) break;
      if (
        (entry.name.startsWith(".") && entry.name !== ".research-build") ||
        ["node_modules", "vendor", "dist", "build", "__pycache__"].includes(
          entry.name,
        )
      )
        continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 8) queue.push({ dir: target, depth: depth + 1 });
        else warnings.add(`Depth limit reached: ${target}`);
      } else if (
        entry.isFile() &&
        (core.isTextFile(target) || /\.pdf$/i.test(target))
      ) {
        if (++count > 2000) break;
        yield target;
      }
    }
  }
  if (queue.length || budget <= 0 || count >= 2000)
    warnings.add(`File limit reached: ${root}`);
}
function snippet(text, index, length) {
  return (
    (index > 70 ? "…" : "") +
    text
      .slice(Math.max(0, index - 70), index + length + 110)
      .replace(/\s+/g, " ")
  );
}
async function search({
  id,
  query,
  projects,
  archives,
  chats,
  initialWarnings = [],
}) {
  const mine = ++generation;
  const needle = normalize(query);
  const results = [],
    warnings = new Set(initialWarnings);
  let scanned = 0;
  const counts = new Map();
  const add = (result) => {
    const count = counts.get(result.kind) || 0;
    if (count < 150) {
      results.push({ ...result, id: crypto.randomUUID() });
      counts.set(result.kind, count + 1);
    } else
      warnings.add(
        `Showing the first 150 ${result.kind} matches. Refine your query for more specific results.`,
      );
  };
  const progress = () =>
    parentPort.postMessage({
      id,
      results,
      warnings: [...warnings],
      scanned,
      partial: true,
    });
  for (const project of projects) {
    if (mine !== generation) return;
    const base = { projectId: project.id, projectName: project.name };
    const info = [
      project.name,
      project.summary,
      project.notes,
      ...project.tasks.map((t) => t.text),
    ].join("\n");
    const at = normalize(info).indexOf(needle);
    if (at >= 0)
      add({
        ...base,
        kind: "project",
        title: project.name,
        snippet: snippet(normalize(info), at, needle.length),
      });
    for (const chat of chats.filter((c) => c.projectId === project.id)) {
      for (const message of chat.messages) {
        const text = normalize(message.text || "");
        const at = text.indexOf(needle);
        if (at >= 0)
          add({
            ...base,
            kind: "chat",
            title: chat.title,
            chatId: chat.chatId,
            messageId: message.id,
            snippet: snippet(text, at, needle.length),
          });
      }
    }
    const roots = [
      ...(project.folder ? [{ id: "primary", folder: project.folder }] : []),
      ...(project.localFolders || []),
    ];
    const documents = new Set();
    async function inspectPdf(file, target) {
      try {
        const { pages, version, truncated } = await pdfPages(file);
        if (mine !== generation) return;
        if (documents.has(version)) return;
        documents.add(version);
        if (truncated)
          warnings.add(
            `${path.basename(file)}: only the first 1,000 pages were searched`,
          );
        if (!pages.some((p) => p.text.trim()))
          warnings.add(`${path.basename(file)}: no text layer (OCR required)`);
        for (const page of pages) {
          let from = 0,
            count = 0,
            at;
          while ((at = page.text.indexOf(needle, from)) >= 0 && count++ < 20) {
            const span = page.spans.find((s) => s.end > at) || { x: 0, y: 0 };
            add({
              ...base,
              ...target,
              kind: "pdf",
              version,
              page: page.page,
              x: span.x,
              y: span.y,
              query,
              snippet: snippet(page.text, at, needle.length),
            });
            from = at + needle.length;
          }
        }
      } catch (error) {
        warnings.add(`${path.basename(file)}: ${error.message}`);
      }
    }
    progress();
    for (const root of roots) {
      for await (const file of files(root.folder, warnings)) {
        if (mine !== generation) return;
        const relative = path.relative(root.folder, file);
        const target = { title: relative, file: relative, rootId: root.id };
        try {
          await core.safeFile(root.folder, relative);
          if (/\.pdf$/i.test(file)) await inspectPdf(file, target);
          else {
            if (normalize(relative).includes(needle))
              add({ ...base, ...target, kind: "file", snippet: relative });
            const stat = await fs.stat(file);
            if (stat.size <= 2 * 1024 * 1024) {
              const lines = (await fs.readFile(file, "utf8")).split("\n");
              let hits = 0;
              for (let i = 0; i < lines.length && hits < 8; i++) {
                const text = normalize(lines[i]),
                  at = text.indexOf(needle);
                if (at >= 0) {
                  add({
                    ...base,
                    ...target,
                    kind: "file",
                    line: i + 1,
                    snippet: snippet(text, at, needle.length),
                  });
                  hits++;
                }
              }
            } else warnings.add(`${relative}: text file exceeds 2 MB`);
          }
        } catch (error) {
          warnings.add(`${relative}: ${error.message}`);
        }
        scanned++;
        if (scanned % 10 === 0 || /\.pdf$/i.test(file)) progress();
      }
    }
    for (const archive of archives.filter((a) => a.projectId === project.id)) {
      if (mine !== generation) return;
      await inspectPdf(archive.file, {
        title: archive.name,
        documentKey: archive.key,
      });
      for (const note of archive.annotations || []) {
        const text = normalize(`${note.quote}\n${note.comment}`),
          at = text.indexOf(needle);
        if (at >= 0)
          add({
            ...base,
            kind: "annotation",
            title: archive.name,
            documentKey: archive.key,
            page: note.page,
            snippet: snippet(text, at, needle.length),
          });
      }
      scanned++;
      progress();
    }
  }
  if (mine === generation)
    parentPort.postMessage({
      id,
      results,
      warnings: [...warnings],
      scanned,
      partial: false,
    });
}
if (parentPort)
  parentPort.on("message", (request) => {
    if (request.cancel) {
      generation++;
      return;
    }
    void search(request).catch((error) =>
      parentPort.postMessage({ id: request.id, error: error.message }),
    );
  });
module.exports = { normalize, pdfPages, files };
