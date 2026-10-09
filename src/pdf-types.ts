export type AnnotationColor = "yellow" | "green" | "blue" | "rose";
export interface PdfPoint {
  x: number;
  y: number;
}
export interface PdfRect extends PdfPoint {
  width: number;
  height: number;
}
export interface PdfAnnotation {
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
