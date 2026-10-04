import { HistoryIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActiveRun } from "@/lib/automation/store";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import { cancelAutomationRun } from "@/lib/db/automation";

interface Props {
  run: ActiveRun;
}

export function TaskRunBar({ run }: Props) {
  const setView = useAutomationStore((state) => state.setView);
  const selectRun = useAutomationStore((state) => state.selectRun);
  const [cancelling, setCancelling] = useState(false);
  const { summary, steps } = run;
  const current = [...steps].reverse().find((step) => step.status === "running") ?? steps.at(-1);
  const total = Math.max(summary.stepsTotal, 1);
  const progress = Math.min(summary.stepsDone / total, 1);
  const position = Math.min(summary.stepsDone + 1, summary.stepsTotal);

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex items-center gap-3 overflow-hidden border-t bg-card px-4 py-2.5 animate-in duration-200 fade-in-0 slide-in-from-bottom-2 motion-reduce:slide-in-from-bottom-0"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 origin-left bg-primary transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${progress})` }}
      />
      <LoaderCircleIcon
        className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden
      />
      <p className="min-w-0 flex-1 truncate text-[13px]">
        <span className="font-medium">Läuft</span>
        <span className="text-muted-foreground">
          {" · "}
          <span className="tabular-nums">
            Schritt {position}/{summary.stepsTotal}
          </span>
          {current ? ` ${current.stepName}` : ""}
          {current?.iteration != null ? ` · Durchlauf ${current.iteration + 1}` : ""}
          {current && current.attempt > 1 ? ` · Versuch ${current.attempt}` : ""}
        </span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={cancelling}
        onClick={async () => {
          setCancelling(true);
          try {
            await cancelAutomationRun(summary.id);
          } catch (error) {
            toast.error(String(error));
            setCancelling(false);
          }
        }}
      >
        <SquareIcon className="fill-current" />
        {cancelling ? "Wird abgebrochen …" : "Abbrechen"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          selectRun(summary.id);
          setView("history");
        }}
      >
        <HistoryIcon />
        Verlauf öffnen
      </Button>
    </div>
  );
}
