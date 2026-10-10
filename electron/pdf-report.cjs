// Facts about a compiled PDF that submission systems check: page count,
// document metadata, and fonts that are not embedded or are Type 3 bitmaps.
async function pdfReport(bytes) {
  const { PDFDocument, PDFDict, PDFName, PDFArray } = require("pdf-lib");
  const document = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  const context = document.context;
  const name = (dict, key) => {
    const value = dict.lookup(PDFName.of(key));
    return value instanceof PDFName ? value.decodeText() : "";
  };
  // Subset prefixes such as ABCDEF+ are dropped so one font is listed once.
  const fontName = (dict) =>
    name(dict, "BaseFont").replace(/^[A-Z]{6}\+/, "") || "unnamed font";
  const embedded = (descriptor) =>
    descriptor instanceof PDFDict &&
    ["FontFile", "FontFile2", "FontFile3"].some((key) =>
      descriptor.has(PDFName.of(key)),
    );
  const notEmbedded = new Set(),
    type3 = new Set();
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || name(object, "Type") !== "Font")
      continue;
    const subtype = name(object, "Subtype");
    if (subtype === "Type3") type3.add(fontName(object));
    else if (subtype === "Type0") {
      const descendants = object.lookup(PDFName.of("DescendantFonts"));
      const child =
        descendants instanceof PDFArray ? descendants.lookup(0) : null;
      if (
        child instanceof PDFDict &&
        !embedded(child.lookup(PDFName.of("FontDescriptor")))
      )
        notEmbedded.add(fontName(object));
    } else if (!embedded(object.lookup(PDFName.of("FontDescriptor"))))
      notEmbedded.add(fontName(object));
  }
  return {
    pages: document.getPageCount(),
    author: document.getAuthor() || "",
    title: document.getTitle() || "",
    notEmbedded: [...notEmbedded].sort(),
    type3: [...type3].sort(),
  };
}
// Parsing a long PDF takes seconds, so the main process reads it in a worker
// and stays responsive.
function pdfReportInWorker(file) {
  const { Worker } = require("node:worker_threads");
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { file } });
    worker.once("message", (result) =>
      result.error ? reject(new Error(result.error)) : resolve(result.value),
    );
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code) reject(new Error("The PDF could not be checked."));
    });
  });
}
const { isMainThread, parentPort, workerData } = require("node:worker_threads");
if (!isMainThread && workerData?.file)
  require("node:fs/promises")
    .readFile(workerData.file)
    .then(pdfReport)
    .then(
      (value) => parentPort.postMessage({ value }),
      (error) => parentPort.postMessage({ error: error.message }),
    );
module.exports = { pdfReport, pdfReportInWorker };
