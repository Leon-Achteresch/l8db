import { MousePointerClickIcon } from "lucide-react";
import { useEffect } from "react";
import { useAutomationStore } from "@/lib/automation/store";
import { useNow } from "@/lib/automation/use-now";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { HistoryFilters } from "./history-filters";
import { RunDetail } from "./run-detail";
import { RunList } from "./run-list";

export function HistoryView() {
  const runs = useAutomationStore((state) => state.runs);
  const loaded = useAutomationStore((state) => state.runsLoaded);
  const selectedRunId = useAutomationStore((state) => state.selectedRunId);
  const selectRun = useAutomationStore((state) => state.selectRun);
  const anyRunning = runs.some((run) => run.status === "running");
  const now = useNow(1000, anyRunning);
  const feature = useNewFeatureVisibility<HTMLDivElement>("automation.history");

  useEffect(() => {
    if (!selectedRunId && runs[0]) selectRun(runs[0].id);
  }, [selectedRunId, runs, selectRun]);

  return (
    <div
      ref={feature.ref}
      data-testid="automation-history"
      className="flex h-full min-h-0 flex-col"
    >
      <HistoryFilters />
      <div className="flex min-h-0 flex-1">
        <div className="w-[min(22rem,40%)] shrink-0 border-r">
          <RunList
            runs={runs}
            selectedId={selectedRunId}
            loaded={loaded}
            now={now}
            onSelect={selectRun}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selectedRunId ? (
            <RunDetail key={selectedRunId} runId={selectedRunId} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <MousePointerClickIcon aria-hidden className="size-5" />
              <p className="text-xs">Lauf auswählen, um Schritte und Log zu sehen.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
