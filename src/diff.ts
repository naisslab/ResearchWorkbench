export type DiffRow = {
  line: string;
  kind?: "hunk" | "addition" | "deletion";
  left?: number;
  right?: number;
};

// Count source lines from unified patch hunk headers, excluding patch metadata.
export function diffRows(text: string): DiffRow[] | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("@@"));
  if (start < 0) return null;
  let left = 0,
    right = 0;
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(start).map((line): DiffRow => {
    if (line.startsWith("@@")) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      [left, right] = hunk ? [+hunk[1], +hunk[2]] : [0, 0];
      return { line, kind: "hunk" };
    }
    if (line.startsWith("+")) return { line, kind: "addition", right: right++ };
    if (line.startsWith("-")) return { line, kind: "deletion", left: left++ };
    if (line.startsWith("\\")) return { line };
    return { line, left: left++, right: right++ };
  });
}
