const fs = require("node:fs/promises");
const sync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { MAX_PDF_BYTES } = require("./core.cjs");

// A document handle lives until the window closes. Only its byte buffer is
// evicted. An immutable temporary snapshot protects an older visible PDF when
// a new compilation replaces the source file on disk.
function createPdfSessions({
  maxBytes = 128 * 1024 * 1024,
  temporaryRoot = os.tmpdir(),
} = {}) {
  const records = new Map();
  const loading = new Map();
  let directory;
  const signature = (file, projectId, name, sourcePath, stat) =>
    [file, projectId, name, sourcePath, stat.size, stat.mtimeMs].join("\0");
  function open(
    file,
    projectId,
    name = path.basename(file),
    sourcePath = file,
  ) {
    const stat = sync.statSync(file);
    if (!stat.isFile() || stat.size > MAX_PDF_BYTES)
      throw new Error("PDF exceeds 64 MB or is not a regular file.");
    const version = signature(file, projectId, name, sourcePath, stat);
    for (const [url, record] of records)
      if (record.version === version) return url;
    const url = `research-pdf://document/${crypto.randomUUID()}`;
    records.set(url, { file, projectId, name, sourcePath, version });
    return url;
  }
  async function read(projectId, url) {
    const record = records.get(url);
    if (!record || record.projectId !== projectId)
      throw new Error("PDF session expired. Reopen the document.");
    if (!record.bytes) {
      if (!loading.has(url))
        loading.set(
          url,
          (async () => {
            if (record.snapshot)
              record.bytes = await fs.readFile(record.snapshot);
            else {
              const stat = await fs.stat(record.file);
              if (
                signature(
                  record.file,
                  projectId,
                  record.name,
                  record.sourcePath,
                  stat,
                ) !== record.version
              )
                throw new Error(
                  "The PDF changed before it could be opened. Reopen the document.",
                );
              const bytes = await fs.readFile(record.file);
              const after = await fs.stat(record.file);
              if (
                signature(
                  record.file,
                  projectId,
                  record.name,
                  record.sourcePath,
                  after,
                ) !== record.version ||
                bytes.length > MAX_PDF_BYTES
              )
                throw new Error(
                  "The PDF changed while it was opening. Reopen the document.",
                );
              directory ??= fs.mkdtemp(
                path.join(temporaryRoot, "research-pdf-session-"),
              );
              record.snapshot = path.join(
                await directory,
                crypto.randomUUID() + ".pdf",
              );
              await fs.writeFile(record.snapshot, bytes, {
                mode: 0o600,
                flag: "wx",
              });
              record.bytes = bytes;
            }
          })().finally(() => loading.delete(url)),
        );
      await loading.get(url);
    }
    records.delete(url);
    records.set(url, record);
    let bytes = [...records.values()].reduce(
      (sum, item) => sum + (item.bytes?.length || 0),
      0,
    );
    for (const item of records.values()) {
      if (bytes <= maxBytes) break;
      if (item === record) continue;
      bytes -= item.bytes?.length || 0;
      delete item.bytes;
    }
    // Return a stable buffer reference even if another read evicts this record.
    return { ...record, bytes: record.bytes };
  }
  async function clear() {
    await Promise.allSettled([...loading.values()]);
    records.clear();
    if (directory)
      await fs.rm(await directory, { recursive: true, force: true });
    directory = undefined;
  }
  return {
    open,
    read,
    get: (url) => records.get(url),
    clear,
    stats: () => ({
      documents: records.size,
      bytes: [...records.values()].reduce(
        (n, r) => n + (r.bytes?.length || 0),
        0,
      ),
    }),
  };
}
module.exports = { createPdfSessions };
