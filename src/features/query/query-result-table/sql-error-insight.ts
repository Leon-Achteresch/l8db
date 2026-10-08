import type { DatabaseKind } from "@/lib/db";
import { dbErrorCode } from "@/lib/db-error-codes";
import {
  impactCallMarkers,
  locateText,
  type SqlMarker,
  sqlErrorMarkers,
} from "@/lib/sql-diagnostics";

export interface SqlErrorInsight {
  summary: string;
  marker: SqlMarker | null;
  line: number | null;
  column: number | null;
  code: string | null;
  codeLabel: string | null;
  unknown: string | null;
  suggestion: string | null;
  fix: { start: number; end: number; text: string } | null;
}

type Missing = { name: string; target: "column" | "table" };

const MISSING: Array<[RegExp, Missing["target"]]> = [
  [/column "?([^"\s]+?)"? does not exist/i, "column"],
  [/Unknown column '([^']+)'/i, "column"],
  [/no such column: ([\w.$"]+)/i, "column"],
  [/Invalid column name '([^']+)'/i, "column"],
  [/relation "([^"]+)" does not exist/i, "table"],
  [/Table '([^']+)' doesn't exist/i, "table"],
  [/no such table: ([\w.$"]+)/i, "table"],
  [/Invalid object name '([^']+)'/i, "table"],
];

const HINT = /Perhaps you meant to reference the column "([^"]+)"/i;

function lastSegment(name: string): string {
  return name.replaceAll('"', "").split(".").pop() ?? name;
}

function missingName(message: string): Missing | null {
  for (const [pattern, target] of MISSING) {
    const match = pattern.exec(message);
    if (match) return { name: match[1], target };
  }
  return null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export function closestName(name: string, candidates: string[]): string | null {
  const wanted = name.toLowerCase();
  const limit = Math.max(1, Math.floor(wanted.length / 3));
  let best: { name: string; score: number } | null = null;
  for (const candidate of new Set(candidates)) {
    const lower = candidate.toLowerCase();
    if (lower === wanted) continue;
    const score = distance(wanted, lower);
    if (score <= limit && (!best || score < best.score)) best = { name: candidate, score };
  }
  return best?.name ?? null;
}

function summaryOf(message: string, missing: Missing | null): string {
  if (missing)
    return `${missing.target === "column" ? "Spalte" : "Tabelle"} ${missing.name.replaceAll('"', "")} existiert nicht.`;
  return message
    .split("\n")[0]
    .replace(/^(ERROR|FEHLER|ERREUR)\s*:\s*/i, "")
    .trim();
}

function positionOf(sql: string, offset: number) {
  const prefix = sql.slice(0, offset);
  return { line: prefix.split("\n").length, column: offset - prefix.lastIndexOf("\n") };
}

export function sqlErrorInsight({
  error,
  kind,
  source,
  sql,
  columns = [],
  tables = [],
}: {
  error: string;
  kind?: DatabaseKind;
  source?: { text: string; base: number } | null;
  sql?: string;
  columns?: string[];
  tables?: string[];
}): SqlErrorInsight {
  const marker = source
    ? (error.split("\n").flatMap((line) => [
        ...sqlErrorMarkers(line, source.text, source.base, kind),
        ...impactCallMarkers(line, source.text).map((finding) => ({
          ...finding,
          start: finding.start + source.base,
          end: finding.end + source.base,
        })),
      ])[0] ?? null)
    : null;
  const missing = missingName(error);
  const unknown = missing ? lastSegment(missing.name) : null;
  const hinted = HINT.exec(error);
  const suggestion = unknown
    ? hinted
      ? lastSegment(hinted[1])
      : closestName(unknown, missing?.target === "table" ? tables : columns)
    : null;
  const text = sql ?? source?.text ?? "";
  const near = marker?.start ?? source?.base ?? 0;
  const at = unknown && text ? locateText(text, unknown, near) : null;
  const fix =
    at !== null && suggestion && unknown
      ? { start: at, end: at + unknown.length, text: suggestion }
      : null;
  const offset = fix?.start ?? marker?.start ?? null;
  const position = offset !== null && sql !== undefined ? positionOf(sql, offset) : null;
  const known = dbErrorCode(kind, error);
  return {
    summary: summaryOf(error, missing),
    marker,
    line: position?.line ?? null,
    column: position?.column ?? null,
    code: known?.code ?? /SQLSTATE\s+(\w{5})/.exec(error)?.[1] ?? null,
    codeLabel: known?.description ?? null,
    unknown,
    suggestion,
    fix,
  };
}
