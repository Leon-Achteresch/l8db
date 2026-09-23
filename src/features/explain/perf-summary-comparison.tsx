import { useMemo } from "react";

import { type SavedPerfTest, summarizeRuns } from "@/lib/perf-test";

interface PerfSummaryComparisonProps {
  left: SavedPerfTest | null;
  right: SavedPerfTest;
  leftLabel: string;
  rightLabel: string;
}

interface Row {
  label: string;
  unit: "ms" | "per-sec" | "count";
  left: number | null;
  right: number | null;
  lowerIsBetter: boolean;
}

function format(value: number | null, unit: Row["unit"]): string {
  if (value === null) return "—";
  if (unit === "ms") return `${value.toFixed(2)} ms`;
  if (unit === "per-sec") return `${value.toFixed(1)} /s`;
  return value.toLocaleString("de-DE");
}

function rowsFor(left: SavedPerfTest | null, right: SavedPerfTest): Row[] {
  const a = left ? summarizeRuns(left.runs, left.elapsedMs) : null;
  const b = summarizeRuns(right.runs, right.elapsedMs);
  return [
    {
      label: "Median",
      unit: "ms",
      left: a?.duration?.median ?? null,
      right: b.duration?.median ?? null,
      lowerIsBetter: true,
    },
    {
      label: "p95",
      unit: "ms",
      left: a?.duration?.p95 ?? null,
      right: b.duration?.p95 ?? null,
      lowerIsBetter: true,
    },
    {
      label: "Maximum",
      unit: "ms",
      left: a?.duration?.max ?? null,
      right: b.duration?.max ?? null,
      lowerIsBetter: true,
    },
    {
      label: "Durchsatz",
      unit: "per-sec",
      left: a?.throughputPerSec ?? null,
      right: b.throughputPerSec ?? null,
      lowerIsBetter: false,
    },
    {
      label: "Fehler",
      unit: "count",
      left: a ? a.errors : null,
      right: b.errors,
      lowerIsBetter: true,
    },
    {
      label: "Parallele Verbindungen",
      unit: "count",
      left: left?.concurrency ?? null,
      right: right.concurrency,
      lowerIsBetter: false,
    },
  ];
}

function deltaClass(row: Row): string {
  if (row.left === null || row.right === null || row.left === row.right) return "";
  if (row.label === "Parallele Verbindungen") return "";
  const better = row.lowerIsBetter ? row.right < row.left : row.right > row.left;
  return better ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
}

export function PerfSummaryComparison({
  left,
  right,
  leftLabel,
  rightLabel,
}: PerfSummaryComparisonProps) {
  const rows = useMemo(() => rowsFor(left, right), [left, right]);
  const differentSql = left !== null && left.sql.trim() !== right.sql.trim();
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <span className="text-xs font-semibold">Kennzahlen vergleichen</span>
      {differentSql && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Die beiden Tests haben unterschiedliche Abfragen gemessen.
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Kennzahl</th>
              <th className="px-3 py-1.5 text-right font-medium">{leftLabel}</th>
              <th className="px-3 py-1.5 text-right font-medium">{rightLabel}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row) => (
              <tr key={row.label} className="border-t">
                <td className="px-3 py-1.5 font-sans">{row.label}</td>
                <td className="px-3 py-1.5 text-right">{format(row.left, row.unit)}</td>
                <td className={`px-3 py-1.5 text-right ${deltaClass(row)}`}>
                  {format(row.right, row.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
