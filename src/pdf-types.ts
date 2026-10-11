export type AnnotationColor = "yellow" | "green" | "blue" | "rose";
export interface PdfPoint {
  x: number;
  y: number;
}
/** A spot on a page, in PDF points from the page's top-left corner. */
export interface PdfTarget extends PdfPoint {
  page: number;
}
/** Reading position; `offset` is the fraction of `page` scrolled past the viewport top. */
export interface PdfView {
  page: number;
  offset: number;
  zoom: number;
  showNotes: boolean;
}
export interface PdfRect extends PdfPoint {
  width: number;
  height: number;
}
export interface PdfAnnotation {
  resolved?: boolean;
  id: string;
  kind: "highlight" | "note" | "ink";
  page: number;
  color: AnnotationColor;
  quote: string;
  comment: string;
  createdAt: string;
  rects?: PdfRect[];
  points?: PdfPoint[];
  position?: PdfPoint;
}
export interface AnnotatedPdfData {
  archived?: boolean;
  /** The project's own compiled PDF, which stays on disk and is rebuilt. */
  compiled?: boolean;
  key: string;
  name: string;
  data: Uint8Array;
  annotations: PdfAnnotation[];
  updatedAt: string;
}
export interface PdfVersion {
  key: string;
  name: string;
  updatedAt: string;
  count: number;
  pageCount: number;
}
