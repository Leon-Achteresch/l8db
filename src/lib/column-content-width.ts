import {
  type GridColumnKind,
  jsonEntries,
  shortUuid,
  timestampDisplay,
} from "@/lib/grid-cell-format";
import { tableCellPreview } from "@/lib/table-cell-preview";
import type { TableStyle } from "@/lib/table-style";

const MONO_CHAR = 7.22;
const SANS_CHAR = 6.6;
const CELL_CHROME = 18;
const HEADER_CHROME = 52;
const FK_CHROME = 16;
const PILL_CHROME = 24;
const SAMPLE_ROWS = 200;
const PREVIEW_LIMIT = 80;

export const CONTENT_COLUMN_MIN = 44;
export const CONTENT_COLUMN_MAX = 360;
export const PROFILE_COLUMN_MIN = 108;

export function compactCellText(value: unknown): string {
  const preview = tableCellPreview(value, PREVIEW_LIMIT);
  return preview.kind === "uuid" ? shortUuid(String(value)) : preview.text;
}

function semanticCellWidth(
  value: unknown,
  kind: GridColumnKind,
  categorical: boolean,
  now: Date,
): number {
  if (value === null || value === undefined) return 4 * SANS_CHAR + 12;
  if (kind === "boolean" || typeof value === "boolean") return 16;
  if (categorical) return String(value).length * SANS_CHAR + PILL_CHROME;
  if (kind === "date" && typeof value === "string") {
    const display = timestampDisplay(value, now);
    if (display)
      return display.primary.length * SANS_CHAR + (display.secondary.length + 1) * MONO_CHAR;
  }
  if (kind === "json") {
    const entries = jsonEntries(value);
    if (entries)
      return (
        entries.reduce((sum, [key, entry]) => sum + key.length + entry.length + 1, 0) * SANS_CHAR +
        (entries.length - 1) * 3 * SANS_CHAR
      );
  }
  const text = compactCellText(value);
  const mono = kind === "number" || kind === "key" || kind === "uuid";
  return text.length * (mono ? MONO_CHAR : SANS_CHAR) + (kind === "key" ? 12 : 0);
}

export type ContentWidthInput = {
  name: string;
  hasFk: boolean;
  kind: GridColumnKind;
  categorical: boolean;
  values: readonly unknown[];
  style: TableStyle;
  uiScale: number;
  now?: Date;
};

export function contentColumnWidth({
  name,
  hasFk,
  kind,
  categorical,
  values,
  style,
  uiScale,
  now = new Date(),
}: ContentWidthInput): number {
  let width = name.length * MONO_CHAR + HEADER_CHROME + (hasFk ? FK_CHROME : 0);
  const count = Math.min(values.length, SAMPLE_ROWS);
  for (let i = 0; i < count; i++) {
    const value = values[i];
    const cell =
      style === "semantic"
        ? semanticCellWidth(value, kind, categorical, now)
        : compactCellText(value).length * MONO_CHAR;
    if (cell + CELL_CHROME > width) width = cell + CELL_CHROME;
    if (width >= CONTENT_COLUMN_MAX) break;
  }
  const min = style === "profile" ? PROFILE_COLUMN_MIN : CONTENT_COLUMN_MIN;
  const clamped = Math.min(CONTENT_COLUMN_MAX, Math.max(min, Math.ceil(width)));
  return Math.round((clamped * uiScale) / 100);
}
