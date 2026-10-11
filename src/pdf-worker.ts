import { GlobalWorkerOptions } from "pdfjs-dist";
// The 1 MB worker is bundled locally and loads with the first PDF. A blob
// module also works in the packaged file:// renderer.
let worker: Promise<void> | undefined;
export const loadPdfWorker = () =>
  (worker ??= import("pdfjs-dist/build/pdf.worker.min.mjs?raw").then(
    ({ default: source }) => {
      GlobalWorkerOptions.workerSrc = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
    },
    (error) => {
      // The next PDF tries again.
      worker = undefined;
      throw error;
    },
  ));
