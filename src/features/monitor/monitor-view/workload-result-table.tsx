import { firstLine } from "@/features/monitor/monitor-view/format";
import { summarizeRuns } from "@/lib/perf-test";
import type { SavedWorkloadResult } from "@/lib/workload";

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)} ms`;
}

export function WorkloadResultTable({ result }: { result: SavedWorkloadResult }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Statement</th>
            <th className="px-3 py-1.5 text-right font-medium">Median</th>
            <th className="px-3 py-1.5 text-right font-medium">p95</th>
            <th className="px-3 py-1.5 text-right font-medium">Max</th>
            <th className="px-3 py-1.5 text-right font-medium">Durchsatz</th>
            <th className="px-3 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {result.results.map((entry, index) => {
            const summary = entry.skipped ? null : summarizeRuns(entry.runs, entry.elapsedMs);
            const firstError = entry.runs.find((run) => run.error)?.error ?? null;
            const status = entry.skipped
              ? `übersprungen: ${entry.skipped}`
              : summary && summary.errors > 0
                ? `${summary.errors} Fehler: ${firstError}`
                : `${entry.runs.length} Läufe ok`;
            return (
              <tr key={`${index}-${entry.sql}`}>
                <td className="max-w-[420px] truncate px-3 py-1.5 font-mono" title={entry.sql}>
                  {firstLine(entry.sql)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {ms(summary?.duration?.median)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{ms(summary?.duration?.p95)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{ms(summary?.duration?.max)}</td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {summary?.throughputPerSec == null
                    ? "—"
                    : `${summary.throughputPerSec.toFixed(1)} /s`}
                </td>
                <td
                  className={`max-w-64 truncate px-3 py-1.5 ${entry.skipped || (summary && summary.errors > 0) ? "text-destructive" : "text-muted-foreground"}`}
                  title={status}
                >
                  {status}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
