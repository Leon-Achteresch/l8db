export interface AiDiffLine {
  id: string;
  type: "added" | "removed" | "context";
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function parseAiDiff(diff: string, id: string): AiDiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  let inHunk = false;
  let oldRemaining = 0;
  let newRemaining = 0;
  const lines: AiDiffLine[] = [];
  for (const [index, raw] of diff.split("\n").entries()) {
    const line = raw.replace(/\r$/, "");
    const entryId = `${id}-${index}`;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      inHunk = true;
      lines.push({ id: entryId, type: "context", content: line });
      continue;
    }
    if (
      /^(diff --git |index |(?:new|deleted) file mode |(?:old|new) mode |similarity index |rename (?:from|to) )/.test(
        line,
      )
    ) {
      inHunk = false;
      continue;
    }
    if (!inHunk && /^(--- |\+\+\+ )/.test(line)) continue;
    if (line.startsWith("\\")) {
      lines.push({ id: entryId, type: "context", content: line });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ id: entryId, type: "added", newLine: newLine++, content: line.slice(1) });
      newRemaining--;
    } else if (line.startsWith("-")) {
      lines.push({ id: entryId, type: "removed", oldLine: oldLine++, content: line.slice(1) });
      oldRemaining--;
    } else if (line.startsWith(" ")) {
      lines.push({
        id: entryId,
        type: "context",
        oldLine: oldLine++,
        newLine: newLine++,
        content: line.slice(1),
      });
      oldRemaining--;
      newRemaining--;
    } else if (line) {
      lines.push({ id: entryId, type: "context", content: line });
    }
    if (inHunk && oldRemaining <= 0 && newRemaining <= 0) inHunk = false;
  }
  return lines;
}
