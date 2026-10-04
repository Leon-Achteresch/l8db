import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  HistoryIcon,
  RotateCcwIcon,
  SquareIcon,
  StepForwardIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatDateTime,
  formatDuration,
  runStatusLabel,
  runStatusTone,
  triggerLabel,
} from "@/lib/automation/format";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import { useNow } from "@/lib/automation/use-now";
import { cancelAutomationRun, getAutomationRun, type RunTaskInput } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { RunLog } from "./run-log";
import { RunOutputs } from "./run-outputs";
import { RunTimeline } from "./run-timeline";
import { StatusIcon } from "./status-icon";

interface Props {
  runId: string;
}

const PILL = {
  running: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/12 text-amber-800 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
} as const;

export function RunDetail({ runId }: Props) {
  const active = useAutomationStore((state) => state.activeRuns[runId]);
  const listed = useAutomationStore((state) => state.runs.find((run) => run.id === runId));
  const startRun = useAutomationStore((state) => state.startRun);
  const selectRun = useAutomationStore((state) => state.selectRun);
  const [tab, setTab] = useState("log");
  const live = Boolean(active) || listed?.status === "running";
  const now = useNow(1000, live);
  const detail = useQuery({
    queryKey: ["automation", "run", runId, listed?.status, listed?.finishedAt],
    queryFn: () => getAutomationRun(runId),
    placeholderData: (previous) => (previous?.summary.id === runId ? previous : undefined),
  });

  const data = detail.data;
  const summary = active?.summary ?? listed ?? data?.summary;
  const steps =
    active && active.steps.length >= (data?.steps.length ?? 0) ? active.steps : (data?.steps ?? []);
  const logs = useMemo(() => {
    const stored = data?.logs ?? [];
    if (!active) return stored;
    const last = stored.at(-1)?.seq ?? -1;
    return [...stored, ...active.logs.filter((line) => line.seq > last)];
  }, [data?.logs, active]);
  const stepNames = useMemo(
    () => new Map(steps.map((step) => [step.stepId, step.stepName])),
    [steps],
  );
  const failedStep = steps.find(
    (step) => step.depth === 0 && (step.status === "failed" || step.status === "timeout"),
  );

  if (!summary)
    return detail.error ? (
      <p className="p-6 text-sm text-destructive">{String(detail.error)}</p>
    ) : (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  const running = summary.status === "running";
  const duration = running ? now - new Date(summary.startedAt).getTime() : summary.durationMs;
  const tone = runStatusTone(summary.status);
  const current = running ? steps.filter((step) => step.status === "running").at(-1) : undefined;

  const rerun = async (input: Omit<RunTaskInput, "taskId">, label: string) => {
    try {
      const id = await startRun({ taskId: summary.taskId, rerunOf: summary.id, ...input });
      toast.success(label);
      selectRun(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const cancel = async () => {
    try {
      const accepted = await cancelAutomationRun(summary.id);
      if (!accepted) toast.info("Lauf ist bereits beendet.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const meta = [
    { label: "Start", value: formatDateTime(summary.startedAt) },
    { label: "Dauer", value: formatDuration(duration) },
    {
      label: "Auslöser",
      value: summary.triggerDetail
        ? `${triggerLabel(summary.trigger)} · ${summary.triggerDetail}`
        : triggerLabel(summary.trigger),
    },
    { label: "Umgebung", value: summary.environment ?? "Standard" },
    { label: "Schritte", value: `${summary.stepsDone} von ${summary.stepsTotal}` },
  ];

  return (
    <article
      aria-labelledby="run-detail-title"
      data-testid="automation-run-detail"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-5"
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
            <span
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                PILL[tone],
              )}
            >
              <StatusIcon status={summary.status} className="size-3" label />
              {runStatusLabel(summary.status)}
            </span>
            <h2
              id="run-detail-title"
              className="text-lg font-semibold tracking-tight text-balance break-words"
            >
              {summary.taskName}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {running ? (
              <Button size="sm" variant="outline" onClick={() => void cancel()}>
                <SquareIcon className="fill-current" />
                Abbrechen
              </Button>
            ) : (
              <div className="flex items-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-r-none"
                  onClick={() => void rerun({}, "Lauf erneut gestartet")}
                >
                  <RotateCcwIcon />
                  Erneut ausführen
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="Weitere Optionen zum erneuten Ausführen"
                      className="-ml-px rounded-l-none"
                    >
                      <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem
                      disabled={!failedStep}
                      onSelect={() =>
                        failedStep &&
                        void rerun(
                          { fromStep: failedStep.stepId },
                          `Ab „${failedStep.stepName}“ gestartet`,
                        )
                      }
                    >
                      <StepForwardIcon />
                      Ab fehlgeschlagenem Schritt
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void rerun(
                          { useOriginalDefinition: true },
                          "Mit ursprünglicher Definition gestartet",
                        )
                      }
                    >
                      <HistoryIcon />
                      Mit ursprünglicher Definition
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {meta.map((entry) => (
            <div key={entry.label} className="flex flex-col gap-0.5">
              <dt className="text-[11px] text-muted-foreground">{entry.label}</dt>
              <dd className="text-[13px] tabular-nums">{entry.value}</dd>
            </div>
          ))}
        </dl>
        {current && (
          <p className="text-xs text-primary" aria-live="polite">
            Schritt {current.seq}: {current.stepName} …
          </p>
        )}
        {summary.error && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/25 bg-destructive/6 px-3.5 py-2.5"
          >
            <p className="text-xs font-semibold text-destructive">Fehler</p>
            <p className="mt-0.5 text-[13px] break-words whitespace-pre-wrap text-foreground/90">
              {summary.error}
            </p>
          </div>
        )}
      </header>

      <section aria-labelledby="run-timeline-title" className="flex flex-col gap-2">
        <h3 id="run-timeline-title" className="text-[13px] font-semibold">
          Zeitleiste
        </h3>
        <RunTimeline
          steps={steps}
          startedAt={summary.startedAt}
          finishedAt={summary.finishedAt}
          live={running}
          now={now}
        />
      </section>

      <Tabs value={tab} onValueChange={setTab} className="gap-3">
        <TabsList variant="line" className="h-8">
          <TabsTrigger value="log" className="text-xs">
            Log
          </TabsTrigger>
          <TabsTrigger value="outputs" className="text-xs">
            Ausgaben
            {(data?.outputs.length ?? summary.outputs) > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {data?.outputs.length ?? summary.outputs}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="vars" className="text-xs">
            Variablen
          </TabsTrigger>
          <TabsTrigger value="definition" className="text-xs">
            Definition
          </TabsTrigger>
        </TabsList>
        <TabsContent value="log">
          <RunLog logs={logs} steps={steps} live={running} />
        </TabsContent>
        <TabsContent value="outputs">
          <RunOutputs outputs={data?.outputs ?? []} stepNames={stepNames} />
        </TabsContent>
        <TabsContent value="vars">
          {data && Object.keys(data.vars).length > 0 ? (
            <dl className="grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-4 gap-y-1.5 rounded-xl border px-3.5 py-3 text-xs">
              {Object.entries(data.vars).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="font-mono text-muted-foreground">{name}</dt>
                  <dd className="min-w-0 font-mono break-all">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-4 text-xs text-muted-foreground">
              {data ? "Keine Variablen in diesem Lauf." : "Wird geladen …"}
            </p>
          )}
        </TabsContent>
        <TabsContent value="definition">
          <pre className="max-h-96 overflow-auto rounded-xl border bg-muted/30 p-3 font-mono text-[11px] leading-5">
            {data ? JSON.stringify(data.definition, null, 2) : "Wird geladen …"}
          </pre>
        </TabsContent>
      </Tabs>
    </article>
  );
}
