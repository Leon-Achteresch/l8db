import { resultCellText } from "@/lib/result-grid";
import { type TimestampOptions, timestampCellText } from "@/lib/timestamp-display";

export const RESULT_WIDTH_SAMPLE_ROWS = 200;
export const RESULT_WIDTH_MAX_MEASUREMENTS = 8_000;
export const RESULT_WIDTH_MAX = 600;

export function resultColumnWidths(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
  measure: (text: string) => number,
  content: boolean,
  timestamps: TimestampOptions,
): Record<string, number> {
  const sampleSize = Math.min(
    RESULT_WIDTH_SAMPLE_ROWS,
    Math.floor(RESULT_WIDTH_MAX_MEASUREMENTS / Math.max(1, columns.length)),
    rows.length,
  );
  return Object.fromEntries(
    columns.map((column) => {
      let width = measure(column.slice(0, 256)) + 48;
      for (let i = 0; content && i < sampleSize && width < RESULT_WIDTH_MAX; i++) {
        const row = rows[Math.floor((i * rows.length) / sampleSize)];
        const value = row[column];
        const text =
          typeof value === "object" && value !== null
            ? Array.isArray(value)
              ? "[…]"
              : "{…}"
            : (timestampCellText(value, timestamps) ?? resultCellText(value));
        width = Math.max(width, measure(text.slice(0, 256)) + 32);
      }
      return [column, Math.min(RESULT_WIDTH_MAX, Math.max(64, Math.ceil(width)))];
    }),
  );
}
