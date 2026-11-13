import { SirenIcon } from "lucide-react";
import { useMemo } from "react";
import { FeatureEmptyState } from "@/components/feature-empty-state/feature-empty-state";
import { useAutomationStore } from "@/lib/automation/store";
import { TASK_TEMPLATES } from "@/lib/automation/templates";
import { useNow } from "@/lib/automation/use-now";
import type { AlertStatus, Step } from "@/lib/db/automation";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { AlertCard } from "./alert-card";

const ORDER: Record<AlertStatus, number> = { triggered: 0, error: 1, unknown: 2, ok: 3 };

function alertSteps(steps: Step[]): Step[] {
  return steps.flatMap((step) => [
    ...(step.action.type === "alert" ? [step] : []),
    ...(step.action.type === "loop" ? alertSteps(step.action.steps) : []),
  ]);
}

export function AlertsView() {
  const tasks = useAutomationStore((state) => state.tasks);
  const openDraft = useAutomationStore((state) => state.openDraft);
  const now = useNow(30_000);
  const feature = useNewFeatureVisibility<HTMLDivElement>("automation.alerts");
  const cards = useMemo(
    () =>
      tasks
        .flatMap((summary) =>
          alertSteps(summary.task.steps).map((step) => ({
            summary,
            step,
            state: summary.alerts.find((alert) => alert.stepId === step.id),
          })),
        )
        .sort(
          (a, b) =>
            ORDER[a.state?.status ?? "unknown"] - ORDER[b.state?.status ?? "unknown"] ||
            a.summary.task.name.localeCompare(b.summary.task.name, "de"),
        ),
    [tasks],
  );
  const template = TASK_TEMPLATES.find((entry) => entry.id === "query-alert");
  const counts = cards.reduce<Record<AlertStatus, number>>(
    (sum, card) => {
      sum[card.state?.status ?? "unknown"] += 1;
      return sum;
    },
    { triggered: 0, error: 0, unknown: 0, ok: 0 },
  );

  return (
    <div
      ref={feature.ref}
      data-testid="automation-alerts"
      className="h-full min-h-0 overflow-y-auto"
    >
      {cards.length === 0 ? (
        <FeatureEmptyState
          icon={SirenIcon}
          title="Noch keine Alarme"
          featureId="automation.alerts"
          className="mx-auto h-full max-w-md justify-center"
          action={
            template
              ? {
                  label: `Vorlage „${template.name}“ öffnen`,
                  onClick: () => openDraft(template.build()),
                }
              : undefined
          }
        />
      ) : (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Alarme</h2>
            <p className="text-sm text-muted-foreground">
              {counts.triggered > 0 ? `${counts.triggered} ausgelöst` : "Kein Alarm ausgelöst"}
              {counts.error > 0 && ` · ${counts.error} mit Fehler`}
              {` · ${cards.length} insgesamt`}
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3">
            {cards.map((card) => (
              <AlertCard
                key={`${card.summary.task.id}-${card.step.id}`}
                summary={card.summary}
                step={card.step}
                state={card.state}
                now={now}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
