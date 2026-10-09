export interface SelectionLines {
  getLineFirstNonWhitespaceColumn(lineNumber: number): number;
  getLineMaxColumn(lineNumber: number): number;
}

export interface LineRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export function selectionRangesWithoutIndent(
  lines: SelectionLines,
  selections: readonly LineRange[],
  visible: readonly { startLineNumber: number; endLineNumber: number }[],
): LineRange[] {
  const ranges: LineRange[] = [];
  for (const selection of selections) {
    const { startLineNumber, startColumn, endLineNumber, endColumn } = selection;
    if (startLineNumber === endLineNumber) {
      if (startColumn !== endColumn)
        ranges.push({ startLineNumber, startColumn, endLineNumber, endColumn });
      continue;
    }
    for (const view of visible) {
      const last = Math.min(endLineNumber, view.endLineNumber);
      for (let line = Math.max(startLineNumber, view.startLineNumber); line <= last; line++) {
        const text = lines.getLineFirstNonWhitespaceColumn(line);
        if (text === 0) continue;
        const from = Math.max(line === startLineNumber ? startColumn : 1, text);
        const to = line === endLineNumber ? endColumn : lines.getLineMaxColumn(line);
        if (from < to)
          ranges.push({
            startLineNumber: line,
            startColumn: from,
            endLineNumber: line,
            endColumn: to,
          });
      }
    }
  }
  return ranges;
}
