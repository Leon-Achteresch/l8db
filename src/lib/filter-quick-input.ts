import { type ParsedFilter, parseFilterExpression } from "@/lib/filter-parser";
import type { FilterKind } from "@/lib/sql-filter";

export const QUICK_FILTER_SUGGESTIONS = 6;
const MAX_INPUT = 2_000;
const MAX_COLUMN_NAME = 128;

export interface QuickFilterAnalysis {
  parsed: ParsedFilter | null;
  error: string;
  word: { from: number; text: string } | null;
  suggestions: string[];
}

function rankColumns(columns: string[], prefix: string): string[] {
  const lower = prefix.toLowerCase();
  if (!lower) return columns.slice(0, QUICK_FILTER_SUGGESTIONS);
  if (lower.length > MAX_COLUMN_NAME) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const column of columns) {
    const name = column.toLowerCase();
    if (name === lower) continue;
    if (name.startsWith(lower)) {
      starts.push(column);
      if (starts.length >= QUICK_FILTER_SUGGESTIONS) break;
    } else if (contains.length < QUICK_FILTER_SUGGESTIONS && name.includes(lower)) {
      contains.push(column);
    }
  }
  return [...starts, ...contains].slice(0, QUICK_FILTER_SUGGESTIONS);
}

export function analyzeQuickFilter(
  text: string,
  columns: string[],
  kind?: FilterKind,
): QuickFilterAnalysis {
  const source = text.trim();
  let parsed: ParsedFilter | null = null;
  let error = "";
  if (source.length > MAX_INPUT) {
    error = "Die Eingabe ist zu lang für den einfachen Filter.";
  } else if (source) {
    try {
      parsed = parseFilterExpression(source, columns, kind === "mongodb" ? undefined : kind);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const prefix = text.match(/[\p{L}\p{N}_$]*$/u)?.[0] ?? "";
  const from = text.length - prefix.length;
  const before = text.slice(0, from).trimEnd();
  const expectsColumn =
    before === "" || /(?:^|[\s(])(?:and|or)$/i.test(before) || before.endsWith("(");
  return {
    parsed,
    error,
    word: expectsColumn ? { from, text: prefix } : null,
    suggestions: expectsColumn && (prefix || before) ? rankColumns(columns, prefix) : [],
  };
}
