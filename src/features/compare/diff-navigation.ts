import type { monaco } from "@/lib/monaco";

export function diffChangeLines(
  changes: readonly monaco.editor.ILineChange[],
  side: "original" | "modified",
): number[] {
  return changes.map((change) => {
    const start =
      side === "original" ? change.originalStartLineNumber : change.modifiedStartLineNumber;
    const end = side === "original" ? change.originalEndLineNumber : change.modifiedEndLineNumber;
    return end === 0 ? start + 1 : start;
  });
}

export function nextDiffLine(
  changeLines: readonly number[],
  currentLine: number,
  direction: 1 | -1,
  lineCount: number,
): number | null {
  const lines = changeLines.map((line) => Math.min(Math.max(line, 1), lineCount));
  if (lines.length === 0) return null;
  if (direction === 1) return lines.find((line) => line > currentLine) ?? lines[0];
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index] < currentLine) return lines[index];
  }
  return lines[lines.length - 1];
}

interface DiffOverviewMarker {
  line: number;
  top: number;
  height: number;
}

export function diffOverviewLine(
  markers: readonly DiffOverviewMarker[],
  offset: number,
  rulerHeight: number,
  scrollHeight: number,
): number | null {
  if (rulerHeight <= 0 || scrollHeight <= 0) return null;
  const ratio = rulerHeight / scrollHeight;
  let nearest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const marker of markers) {
    const top = Math.floor(marker.top * ratio);
    const bottom = Math.floor((marker.top + marker.height) * ratio);
    const halfHeight = Math.max(bottom - Math.floor((top + bottom) / 2), 2);
    const center = Math.max(halfHeight, Math.min(rulerHeight - halfHeight, (top + bottom) / 2));
    const delta = Math.abs(offset - center);
    if (delta <= halfHeight + 1 && delta < distance) {
      nearest = marker.line;
      distance = delta;
    }
  }
  return nearest;
}
