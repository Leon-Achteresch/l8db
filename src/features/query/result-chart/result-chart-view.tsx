import { useDeferredValue, useMemo, useRef } from "react";
import {
  buildChartData,
  profileColumns,
  type ResultChartConfig,
  sanitizeConfig,
  suggestChart,
} from "@/lib/result-chart";
import { ResultChartActions } from "./result-chart-actions";
import { ResultChartCanvas } from "./result-chart-canvas";
import { ResultChartSettings } from "./result-chart-settings";
import type { ResultChartBinding } from "./types";

export function ResultChartView({
  columns,
  rows,
  binding,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  binding: ResultChartBinding;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const roles = useMemo(() => profileColumns(columns, rows), [columns, rows]);
  const stored = binding.state.config;
  const config = useMemo(
    () => (stored ? sanitizeConfig(stored, columns) : suggestChart(columns, rows)),
    [stored, columns, rows],
  );
  const deferred = useDeferredValue(config);
  const data = useMemo(() => buildChartData(rows, deferred), [rows, deferred]);
  const update = (patch: Partial<ResultChartConfig>) =>
    binding.onChange({ ...binding.state, config: { ...config, ...patch } });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResultChartSettings config={config} roles={roles} onChange={update} />
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-[11px] text-muted-foreground">
        {!stored && <span>Automatisch vorgeschlagen</span>}
        {data.truncated && (
          <span className="text-amber-600 dark:text-amber-400">
            Zeigt die ersten {data.rows.length.toLocaleString("de-DE")} von{" "}
            {data.total.toLocaleString("de-DE")} Punkten. Aggregation oder Top N verwenden.
          </span>
        )}
        <div className="ml-auto">
          <ResultChartActions binding={binding} config={config} canvasRef={canvasRef} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResultChartCanvas ref={canvasRef} chart={deferred.chart} data={data} />
      </div>
    </div>
  );
}
