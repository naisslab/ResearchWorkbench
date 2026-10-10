import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfAnnotation, PdfRect } from "./pdf-types";
import {
  indexPdfText,
  matchingRects,
  normalizePdfText,
  type TextSpan,
} from "../electron/pdf-text.mjs";
/** Only unique, exact quotations are transferable. Notes and drawings stay in the original. */
export async function planAnnotationMigration(
  document: PDFDocumentProxy,
  annotations: PdfAnnotation[],
) {
  const pages: {
    page: number;
    text: string;
    spans: TextSpan[];
  }[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const { text, spans } = indexPdfText(content.items);
    pages.push({ page: number, text, spans });
  }
  const matched: PdfAnnotation[] = [],
    unresolved: PdfAnnotation[] = [];
  for (const item of annotations) {
    const quote = normalizePdfText(item.quote);
    if (item.kind !== "highlight" || quote.length < 4) {
      unresolved.push(item);
      continue;
    }
    const occurrences: { page: number; rects: PdfRect[] }[] = [];
    for (const page of pages) {
      let at = page.text.indexOf(quote);
      while (at >= 0 && occurrences.length < 2) {
        occurrences.push({
          page: page.page,
          rects: matchingRects(page.spans, at, quote.length),
        });
        at = page.text.indexOf(quote, at + 1);
      }
    }
    if (
      occurrences.length !== 1 ||
      !occurrences[0].rects.length ||
      occurrences[0].rects.length > 300
    )
      unresolved.push(item);
    else
      matched.push({
        ...item,
        id: crypto.randomUUID(),
        page: occurrences[0].page,
        rects: occurrences[0].rects,
      });
  }
  return { matched, unresolved };
}
