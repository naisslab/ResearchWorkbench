export interface TextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface TextSpan {
  start: number;
  end: number;
  rect: TextRect;
}
export function normalizePdfText(value: string): string;
export function indexPdfText(
  items: (
    | {
        str: string;
        transform: number[];
        width: number;
        height: number;
        hasEOL?: boolean;
      }
    | { type: string }
  )[],
): { text: string; spans: TextSpan[] };
export function matchingRects(
  spans: TextSpan[],
  start: number,
  length: number,
): TextRect[];
