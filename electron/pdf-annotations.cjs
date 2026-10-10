const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicWrite } = require("./core.cjs");
const { createTaskQueue } = require("./task-queue.cjs");
const COLORS = {
  yellow: [0.96, 0.78, 0.24],
  green: [0.3, 0.68, 0.43],
  blue: [0.3, 0.58, 0.86],
  rose: [0.84, 0.4, 0.55],
};
const keyPattern = /^[a-f0-9]{64}$/;
function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function documentKey(projectId, hash) {
  return digest(`${projectId}\0${hash}`);
}
function validateAnnotations(input, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 20000)
    throw new Error("Invalid PDF page count.");
  if (
    !Array.isArray(input) ||
    input.length > 1000 ||
    Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024
  )
    throw new Error("Too many PDF annotations.");
  const ids = new Set();
  const coordinate = (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1000000;
  const point = (value) => value && coordinate(value.x) && coordinate(value.y);
  return input.map((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) ||
      ids.has(item.id) ||
      !["highlight", "note", "ink"].includes(item.kind) ||
      !Object.hasOwn(COLORS, item.color) ||
      !Number.isInteger(item.page) ||
      item.page < 1 ||
      item.page > pageCount ||
      typeof item.comment !== "string" ||
      item.comment.length > 8000 ||
      typeof item.quote !== "string" ||
      item.quote.length > 4000 ||
      typeof item.createdAt !== "string" ||
      !Number.isFinite(Date.parse(item.createdAt))
    )
      throw new Error("Invalid PDF annotation.");
    ids.add(item.id);
    const clean = {
      id: item.id,
      kind: item.kind,
      page: item.page,
      color: item.color,
      quote: item.quote,
      comment: item.comment,
      createdAt: item.createdAt,
    };
    if (item.kind === "highlight") {
      if (
        !Array.isArray(item.rects) ||
        !item.rects.length ||
        item.rects.length > 300 ||
        item.rects.some(
          (rect) =>
            !point(rect) ||
            !coordinate(rect.width) ||
            !coordinate(rect.height) ||
            rect.width <= 0 ||
            rect.height <= 0,
        )
      )
        throw new Error("Invalid highlight geometry.");
      clean.rects = item.rects.map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height,
      }));
    } else if (item.kind === "note") {
      if (!point(item.position)) throw new Error("Invalid note position.");
      clean.position = { x: item.position.x, y: item.position.y };
    } else {
      if (
        !Array.isArray(item.points) ||
        item.points.length < 2 ||
        item.points.length > 4000 ||
        item.points.some((value) => !point(value))
      )
        throw new Error("Invalid drawing geometry.");
      clean.points = item.points.map(({ x, y }) => ({ x, y }));
    }
    return clean;
  });
}
function createAnnotationStore(directory) {
  const file = (key, extension) => {
    if (!keyPattern.test(key)) throw new Error("Invalid document identifier.");
    return path.join(directory, `${key}.${extension}`);
  };
  const queue = createTaskQueue();
  // A document's bytes never change, so each Buffer is hashed once.
  const hashes = new WeakMap();
  const snapshots = new Set();
  function identify(projectId, bytes) {
    if (!hashes.has(bytes)) hashes.set(bytes, digest(bytes));
    const hash = hashes.get(bytes);
    return { hash, key: documentKey(projectId, hash) };
  }
  async function load(projectId, bytes, name, sourcePath) {
    const { hash, key } = identify(projectId, bytes);
    let stored;
    try {
      stored = JSON.parse(await fs.readFile(file(key, "json"), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "PDF annotations could not be read. The existing annotation file has been preserved.",
        );
    }
    if (
      stored &&
      (stored.projectId !== projectId || stored.documentHash !== hash)
    )
      throw new Error("PDF annotation version does not match.");
    return {
      key,
      documentHash: hash,
      name,
      sourcePath,
      annotations: stored
        ? validateAnnotations(stored.annotations, stored.pageCount)
        : [],
      updatedAt: stored?.updatedAt || "",
      pageCount: stored?.pageCount || 0,
    };
  }
  async function save(projectId, bytes, name, sourcePath, input, pageCount) {
    const annotations = validateAnnotations(input, pageCount);
    const { hash, key } = identify(projectId, bytes);
    return queue(async () => {
      if (!snapshots.has(key)) {
        try {
          await fs.access(file(key, "pdf"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await atomicWrite(file(key, "pdf"), bytes);
        }
        snapshots.add(key);
      }
      const updatedAt = new Date().toISOString();
      await atomicWrite(
        file(key, "json"),
        JSON.stringify(
          {
            version: 1,
            key,
            projectId,
            documentHash: hash,
            name,
            sourcePath,
            updatedAt,
            pageCount,
            annotations,
          },
          null,
          2,
        ),
      );
      return { key, updatedAt };
    }, key);
  }
  async function library(projectId) {
    let names;
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const documents = [];
    for (const name of names.filter((name) =>
      keyPattern.test(path.basename(name, ".json")),
    )) {
      const entry = JSON.parse(
        await fs.readFile(path.join(directory, name), "utf8"),
      );
      if (entry.projectId === projectId)
        documents.push({
          key: entry.key,
          name: entry.name,
          updatedAt: entry.updatedAt,
          count: entry.annotations.length,
          pageCount: entry.pageCount,
        });
    }
    return documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function archived(projectId, key) {
    const entry = JSON.parse(await fs.readFile(file(key, "json"), "utf8"));
    if (entry.projectId !== projectId)
      throw new Error("This PDF belongs to a different project.");
    return {
      file: file(key, "pdf"),
      name: entry.name,
      sourcePath: entry.sourcePath,
    };
  }
  return {
    load,
    save,
    library,
    archived,
    flush: queue.settled,
  };
}
async function exportAnnotated(bytes, input, pageCount) {
  const { PDFDocument, PDFHexString } = require("pdf-lib");
  const annotations = validateAnnotations(input, pageCount);
  const document = await PDFDocument.load(bytes);
  if (document.getPageCount() !== pageCount)
    throw new Error("PDF version changed. Reopen it before exporting.");
  const context = document.context;
  for (const annotation of annotations) {
    const page = document.getPage(annotation.page - 1);
    const color = COLORS[annotation.color];
    let bounds, appearance, extras;
    if (annotation.kind === "highlight") {
      const left = Math.min(...annotation.rects.map((r) => r.x)),
        bottom = Math.min(...annotation.rects.map((r) => r.y));
      const right = Math.max(...annotation.rects.map((r) => r.x + r.width)),
        top = Math.max(...annotation.rects.map((r) => r.y + r.height));
      bounds = [left, bottom, right, top];
      const quads = annotation.rects.flatMap((r) => [
        r.x,
        r.y + r.height,
        r.x + r.width,
        r.y + r.height,
        r.x,
        r.y,
        r.x + r.width,
        r.y,
      ]);
      appearance = `q /GS0 gs ${color.join(" ")} rg ${annotation.rects.map((r) => `${r.x - left} ${r.y - bottom} ${r.width} ${r.height} re f`).join("\n")} Q`;
      extras = { Subtype: "Highlight", QuadPoints: quads };
    } else if (annotation.kind === "ink") {
      const left = Math.min(...annotation.points.map((p) => p.x)) - 2,
        bottom = Math.min(...annotation.points.map((p) => p.y)) - 2;
      const right = Math.max(...annotation.points.map((p) => p.x)) + 2,
        top = Math.max(...annotation.points.map((p) => p.y)) + 2;
      bounds = [left, bottom, right, top];
      appearance = `q ${color.join(" ")} RG 1.5 w 1 J 1 j ${annotation.points.map((p, i) => `${p.x - left} ${p.y - bottom} ${i ? "l" : "m"}`).join("\n")} S Q`;
      extras = {
        Subtype: "Ink",
        InkList: [annotation.points.flatMap((p) => [p.x, p.y])],
        BS: { W: 1.5, S: "S" },
      };
    } else {
      const { x, y } = annotation.position;
      bounds = [x, y - 18, x + 18, y];
      appearance = `q ${color.join(" ")} rg 0 0 18 18 re f 0.25 0.25 0.25 RG 0.8 w 4 12 m 14 12 l 4 8 m 14 8 l 4 4 m 10 4 l S Q`;
      extras = { Subtype: "Text", Name: "Comment", Open: false };
    }
    const appearanceRef = context.register(
      context.flateStream(appearance, {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, bounds[2] - bounds[0], bounds[3] - bounds[1]],
        Resources: {
          ExtGState: { GS0: { Type: "ExtGState", ca: 0.3, CA: 0.3 } },
        },
      }),
    );
    const dict = context.obj({
      Type: "Annot",
      ...extras,
      Rect: bounds,
      C: color,
      F: 4,
      Contents: PDFHexString.fromText(annotation.comment || annotation.quote),
      T: PDFHexString.fromText("Research Workbench"),
      NM: PDFHexString.fromText(annotation.id),
      AP: { N: appearanceRef },
    });
    page.node.addAnnot(context.register(dict));
  }
  return Buffer.from(await document.save());
}
module.exports = {
  createAnnotationStore,
  validateAnnotations,
  exportAnnotated,
  documentKey,
  digest,
};
