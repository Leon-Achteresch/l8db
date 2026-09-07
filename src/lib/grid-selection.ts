export type GridCellRef = {
  rowIndex: number;
  columnId: string;
};

export type GridSelection = {
  anchor: GridCellRef;
  focus: GridCellRef;
};

export type GridSelectionRange = {
  rowStart: number;
  rowEnd: number;
  columnIds: string[];
};

export type NumericCell =
  | { kind: "null" }
  | { kind: "number"; value: number }
  | { kind: "text" }
  | { kind: "unsupported" };

export type SelectionStats = {
  cellCount: number;
  rowCount: number;
  columnCount: number;
  nullCount: number;
  numericCount: number;
  textCount: number;
  unsupportedCount: number;
  sum: number | null;
  min: number | null;
  max: number | null;
  average: number | null;
};

const NUMERIC_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const MAX_SIGNIFICANT_DIGITS = 15;

export function selectionRange(
  selection: GridSelection | null,
  columnIds: string[],
): GridSelectionRange | null {
  if (!selection) return null;
  const anchorColumn = columnIds.indexOf(selection.anchor.columnId);
  const focusColumn = columnIds.indexOf(selection.focus.columnId);
  if (anchorColumn === -1 || focusColumn === -1) return null;
  const rowStart = Math.min(selection.anchor.rowIndex, selection.focus.rowIndex);
  const rowEnd = Math.max(selection.anchor.rowIndex, selection.focus.rowIndex);
  if (rowStart < 0) return null;
  return {
    rowStart,
    rowEnd,
    columnIds: columnIds.slice(
      Math.min(anchorColumn, focusColumn),
      Math.max(anchorColumn, focusColumn) + 1,
    ),
  };
}

export function selectionCellCount(range: GridSelectionRange | null): number {
  if (!range) return 0;
  return (range.rowEnd - range.rowStart + 1) * range.columnIds.length;
}

export function isCellInSelection(
  range: GridSelectionRange | null,
  rowIndex: number,
  columnId: string,
): boolean {
  if (!range) return false;
  if (rowIndex < range.rowStart || rowIndex > range.rowEnd) return false;
  return range.columnIds.includes(columnId);
}

export function serializeSelectionCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replace(/\r\n|\r|\n/g, " ").replace(/\t/g, " ");
}

export function selectionToTsv(
  rows: Record<string, unknown>[],
  range: GridSelectionRange | null,
  options?: { includeHeader?: boolean },
): string {
  if (!range) return "";
  const lines: string[] = [];
  if (options?.includeHeader) lines.push(range.columnIds.join("\t"));
  for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;
    lines.push(range.columnIds.map((columnId) => serializeSelectionCell(row[columnId])).join("\t"));
  }
  return lines.join("\n");
}

export function classifyNumericCell(value: unknown): NumericCell {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "text" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { kind: "unsupported" };
    return { kind: "number", value };
  }
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      return { kind: "unsupported" };
    }
    return { kind: "number", value: Number(value) };
  }
  if (typeof value !== "string") return { kind: "text" };
  const text = value.trim();
  if (text === "") return { kind: "text" };
  if (!NUMERIC_PATTERN.test(text)) return { kind: "text" };
  const digits = text.replace(/^[+-]/, "").split(/[eE]/)[0].replace(".", "").replace(/^0+/, "");
  if (digits.replace(/0+$/, "").length > MAX_SIGNIFICANT_DIGITS) return { kind: "unsupported" };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { kind: "unsupported" };
  return { kind: "number", value: parsed };
}

export function summarizeSelection(
  rows: Record<string, unknown>[],
  range: GridSelectionRange | null,
): SelectionStats | null {
  if (!range) return null;
  const stats: SelectionStats = {
    cellCount: 0,
    rowCount: range.rowEnd - range.rowStart + 1,
    columnCount: range.columnIds.length,
    nullCount: 0,
    numericCount: 0,
    textCount: 0,
    unsupportedCount: 0,
    sum: null,
    min: null,
    max: null,
    average: null,
  };
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;
    for (const columnId of range.columnIds) {
      stats.cellCount += 1;
      const cell = classifyNumericCell(row[columnId]);
      if (cell.kind === "null") {
        stats.nullCount += 1;
      } else if (cell.kind === "text") {
        stats.textCount += 1;
      } else if (cell.kind === "unsupported") {
        stats.unsupportedCount += 1;
      } else {
        stats.numericCount += 1;
        sum += cell.value;
        if (cell.value < min) min = cell.value;
        if (cell.value > max) max = cell.value;
      }
    }
  }
  if (stats.numericCount > 0) {
    stats.sum = sum;
    stats.min = min;
    stats.max = max;
    stats.average = sum / stats.numericCount;
  }
  return stats;
}

export function formatSelectionNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER) return String(value);
  return String(Number(value.toPrecision(12)));
}

export function describeSelectionStats(stats: SelectionStats | null): string {
  if (!stats || stats.cellCount === 0) return "";
  const parts = [`${stats.cellCount} Zellen`];
  if (stats.nullCount > 0) parts.push(`${stats.nullCount} NULL`);
  if (stats.numericCount > 0 && stats.sum !== null && stats.average !== null) {
    parts.push(`Σ ${formatSelectionNumber(stats.sum)}`);
    parts.push(`Ø ${formatSelectionNumber(stats.average)}`);
    if (stats.min !== null) parts.push(`Min ${formatSelectionNumber(stats.min)}`);
    if (stats.max !== null) parts.push(`Max ${formatSelectionNumber(stats.max)}`);
  }
  if (stats.unsupportedCount > 0) parts.push(`${stats.unsupportedCount} nicht berechenbar`);
  return parts.join(" · ");
}
