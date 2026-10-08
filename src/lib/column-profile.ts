import { type GridColumnKind, parseDbTimestamp } from "@/lib/grid-cell-format";

export type ColumnProfile =
  | { type: "histogram"; bins: number[]; min: string; max: string; nullRatio: number }
  | {
      type: "categories";
      parts: { value: string; count: number }[];
      total: number;
      nullRatio: number;
    }
  | { type: "boolean"; trueRatio: number; nullRatio: number }
  | { type: "distinct"; distinct: number; total: number; nullRatio: number }
  | { type: "empty" };

const numberFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

function dateLabel(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(2)}`;
}

function numericValue(value: unknown, kind: GridColumnKind): number | null {
  if (kind === "date") {
    if (value instanceof Date) return value.getTime();
    if (typeof value !== "string") return null;
    return parseDbTimestamp(value)?.getTime() ?? null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function histogram(numbers: number[], binCount: number): number[] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of numbers) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  const bins = Array.from({ length: span === 0 ? 1 : binCount }, () => 0);
  for (const value of numbers) {
    const index =
      span === 0 ? 0 : Math.min(binCount - 1, Math.floor(((value - min) / span) * binCount));
    bins[index]++;
  }
  return bins;
}

export function columnProfile(
  values: readonly unknown[],
  kind: GridColumnKind,
  categorical: boolean,
  binCount = 12,
): ColumnProfile {
  if (values.length === 0) return { type: "empty" };
  const present = values.filter((value) => value !== null && value !== undefined);
  const nullRatio = (values.length - present.length) / values.length;
  if (present.length === 0)
    return { type: "distinct", distinct: 0, total: values.length, nullRatio };

  if (kind === "boolean") {
    const trues = present.filter(
      (value) => value === true || value === "true" || value === 1,
    ).length;
    return { type: "boolean", trueRatio: trues / present.length, nullRatio };
  }

  if (categorical) {
    const counts = new Map<string, number>();
    for (const value of present) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
    const parts = [...counts]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return { type: "categories", parts, total: values.length, nullRatio };
  }

  if (kind === "number" || kind === "date") {
    const numbers: number[] = [];
    for (const value of present) {
      const number = numericValue(value, kind);
      if (number !== null) numbers.push(number);
    }
    if (numbers.length === present.length) {
      const min = Math.min(...numbers);
      const max = Math.max(...numbers);
      const label = kind === "date" ? dateLabel : (value: number) => numberFormat.format(value);
      return {
        type: "histogram",
        bins: histogram(numbers, binCount),
        min: label(min),
        max: label(max),
        nullRatio,
      };
    }
  }

  const distinct = new Set(
    present.map((value) => (typeof value === "object" ? JSON.stringify(value) : String(value))),
  ).size;
  return { type: "distinct", distinct, total: present.length, nullRatio };
}
