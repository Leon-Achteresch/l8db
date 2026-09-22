import { useMemo } from "react";

import { firstLine } from "@/features/monitor/monitor-view/format";
import { compareWorkloadResults, type SavedWorkloadResult } from "@/lib/workload";

interface WorkloadComparisonTableProps {
  left: SavedWorkloadResult;
  right: SavedWorkloadResult;
  leftLabel: string;
  rightLabel: string;
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)} ms`;
}

export function WorkloadComparisonTable({
  left,
  right,
  leftLabel,
  rightLabel,
}: WorkloadComparisonTableProps) {
  const rows = useMemo(() => compareWorkloadResults(left, right), [left, right]);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Statement</th>
            <th className="px-3 py-1.5 text-right font-medium">Median {leftLabel}</th>
            <th className="px-3 py-1.5 text-right font-medium">Median {rightLabel}</th>
            <th className="px-3 py-1.5 text-right font-medium">Delta</th>
            <th className="px-3 py-1.5 text-right font-medium">Fehler</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row, index) => (
            <tr key={`${index}-${row.sql}`}>
              <td className="max-w-[420px] truncate px-3 py-1.5 font-mono" title={row.sql}>
                {row.status === "only-left"
                  ? "[nur A] "
                  : row.status === "only-right"
                    ? "[nur B] "
                    : ""}
                {firstLine(row.sql)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{ms(row.left?.median)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{ms(row.right?.median)}</td>
              <td
                className={`px-3 py-1.5 text-right font-mono ${
                  row.deltaMs === null || row.deltaMs === 0
                    ? "text-muted-foreground"
                    : row.deltaMs < 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                }`}
              >
                {row.deltaMs === null
                  ? "—"
                  : `${row.deltaMs > 0 ? "+" : ""}${row.deltaMs.toFixed(2)} ms${row.ratio === null ? "" : ` (${(row.ratio * 100).toFixed(0)} %)`}`}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">
                {row.leftErrors} / {row.rightErrors}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
