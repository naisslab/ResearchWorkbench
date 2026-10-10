/** Shared by search, search highlighting and annotation transfer. */
export const normalizePdfText = (value) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function indexPdfText(items) {
  let text = "",
    previous,
    pendingSpace = false;
  const spans = [];
  for (const item of items) {
    if (!("str" in item)) continue;
    const value = normalizePdfText(item.str);
    if (!value) {
      if (item.str) pendingSpace = true;
      if (item.hasEOL && previous) previous = { ...previous, hasEOL: true };
      continue;
    }
    const [a, b, , , x, y] = item.transform;
    const scale = Math.hypot(a, b) || 1;
    const ux = a / scale,
      uy = b / scale;
    const width = Math.max(1, item.width),
      height = Math.max(1, item.height);
    if (previous) {
      const dehyphenate = previous.hasEOL && text.endsWith("-");
      const endX = previous.transform[4] + previous.width * ux;
      const endY = previous.transform[5] + previous.width * uy;
      const gap = (x - endX) * ux + (y - endY) * uy;
      const cross = Math.abs((x - endX) * -uy + (y - endY) * ux);
      const whitespace =
        pendingSpace || /\s$/.test(previous.str) || /^\s/.test(item.str);
      const cjk =
        /[\u3000-\u9fff]$/.test(text) && /^[\u3000-\u9fff]/.test(value);
      if (dehyphenate) {
        text = text.slice(0, -1);
        spans[spans.length - 1].end = text.length;
      } else if (
        whitespace ||
        (!cjk &&
          (previous.hasEOL || cross > height * 0.5 || gap > height * 0.15))
      )
        text += " ";
    }
    const start = text.length;
    text += value;
    const xs = [
      x,
      x + ux * width,
      x - uy * height,
      x + ux * width - uy * height,
    ];
    const ys = [
      y,
      y + uy * width,
      y + ux * height,
      y + uy * width + ux * height,
    ];
    spans.push({
      start,
      end: text.length,
      rect: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
    });
    previous = item;
    pendingSpace = false;
  }
  return { text, spans };
}

export function matchingRects(spans, start, length) {
  return spans
    .filter((span) => span.end > start && span.start < start + length)
    .map((span) => span.rect);
}
