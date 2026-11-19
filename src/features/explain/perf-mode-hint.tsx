import { AlertTriangleIcon } from "lucide-react";

import { PERF_ANALYZE_HINT, PERF_TIMED_HINT } from "@/lib/perf-test";

export function PerfModeHint({ timed }: { timed: boolean }) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
      <p className="flex items-start gap-2 text-xs">
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span>{timed ? PERF_TIMED_HINT : PERF_ANALYZE_HINT}</span>
      </p>
    </div>
  );
}
