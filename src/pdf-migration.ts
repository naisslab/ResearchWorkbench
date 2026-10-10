import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfAnnotation, PdfRect } from "./pdf-types";
const normalized = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
/** Only unique, exact quotations are transferable. Notes and drawings stay in the original. */
export async function planAnnotationMigration(
  document: PDFDocumentProxy,
  annotations: PdfAnnotation[],
) {
  const pages: {
    page: number;
    text: string;
    spans: { from: number; to: number; rect: PdfRect }[];
  }[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    let text = "";
    const spans = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const from = text.length;
      text += normalized(item.str);
      spans.push({
        from,
        to: text.length,
        rect: {
          x: item.transform[4],
          y: item.transform[5],
          width: Math.max(1, item.width),
          height: Math.max(1, item.height),
        },
      });
    }
    pages.push({ page: number, text, spans });
  }
  const matched: PdfAnnotation[] = [],
    unresolved: PdfAnnotation[] = [];
  for (const item of annotations) {
    const quote = normalized(item.quote);
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
          rects: page.spans
            .filter((span) => span.to > at && span.from < at + quote.length)
            .map((span) => span.rect),
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
