import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatDuration,
  runStatusLabel,
  runStatusTone,
  type StatusTone,
} from "@/lib/automation/format";
import type { StepRun } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./status-icon";

interface Props {
  steps: StepRun[];
  startedAt: string;
  finishedAt: string | null;
  live: boolean;
  now: number;
}

interface Row {
  key: string;
  label: string;
  depth: number;
  iteration: number | null;
  attempts: StepRun[];
}

const BAR: Record<StatusTone, string> = {
  running: "bg-primary",
  success: "bg-emerald-500 dark:bg-emerald-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/40",
};

const SCALE_STEPS = [
  1_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000,
  21_600_000, 86_400_000,
];

function axisTicks(total: number): number[] {
  const rough = total / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let value = step; value <= total * 0.88; value += step) ticks.push(value);
  return ticks;
}

function time(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function groupRows(steps: StepRun[]): Row[] {
  const rows = new Map<string, Row>();
  for (const step of steps) {
    const key = `${step.depth}|${step.stepId}|${step.iteration ?? ""}`;
    const row = rows.get(key);
    if (row) row.attempts.push(step);
    else
      rows.set(key, {
        key,
        label: step.stepName,
        depth: step.depth,
        iteration: step.iteration,
        attempts: [step],
      });
  }
  return [...rows.values()];
}

export function RunTimeline({ steps, startedAt, finishedAt, live, now }: Props) {
  const start = time(startedAt) ?? now;
  const rows = useMemo(() => groupRows(steps), [steps]);
  const end = useMemo(() => {
    const done = time(finishedAt);
    if (done && !live) return done;
    const latest = Math.max(
      now,
      ...steps.map((step) => time(step.finishedAt) ?? time(step.startedAt) ?? start),
    );
    const elapsed = latest - start;
    const span = SCALE_STEPS.find((step) => step >= elapsed * 1.15) ?? elapsed * 1.15;
    return start + span;
  }, [finishedAt, live, now, steps, start]);
  const total = Math.max(end - start, 1);
  const pct = (value: number) => Math.min(100, Math.max(0, ((value - start) / total) * 100));
  const ticks = axisTicks(total).map((value) => value / total);

  if (rows.length === 0)
    return (
      <p className="rounded-xl border border-dashed px-4 py-4 text-xs text-muted-foreground">
        {live ? "Erster Schritt startet …" : "Dieser Lauf hat keine Schritte ausgeführt."}
      </p>
    );

  return (
    <figure className="flex flex-col gap-1" data-testid="automation-run-timeline">
      <figcaption className="sr-only">
        Zeitleiste der Schritte. Jede Zeile nennt Schritt, Status und Dauer.
      </figcaption>
      <div className="grid grid-cols-[minmax(6rem,min(35%,14rem))_1fr_4.5rem] items-end gap-x-3 pb-1 text-[10px] tabular-nums text-muted-foreground">
        <span>Schritt</span>
        <div className="relative h-3.5">
          <span className="absolute bottom-0 left-0">0 s</span>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${tick * 100}%` }}
            >
              {formatDuration(total * tick)}
            </span>
          ))}
        </div>
        <span className="text-right">Dauer</span>
      </div>
      <ol className="flex flex-col">
        {rows.map((row) => {
          const last = row.attempts.at(-1) ?? row.attempts[0];
          const running = last.status === "running";
          const duration = running
            ? now - (time(last.startedAt) ?? now)
            : row.attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
          return (
            <li
              key={row.key}
              className={cn(
                "group/step grid grid-cols-[minmax(6rem,min(35%,14rem))_1fr_4.5rem] items-center gap-x-3 rounded-md py-1 transition-colors hover:bg-muted/50",
                live &&
                  "transition-[background-color,opacity,transform] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
              )}
            >
              <span
                className="flex min-w-0 items-center gap-1.5 text-xs"
                style={{ paddingLeft: `${row.depth * 0.875}rem` }}
              >
                <StatusIcon status={last.status} className="size-3" />
                <span className="truncate" title={row.label}>
                  {row.label}
                </span>
                {row.iteration != null && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    #{row.iteration + 1}
                  </span>
                )}
                {row.attempts.length > 1 && (
                  <span className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                    {row.attempts.length} Versuche
                  </span>
                )}
              </span>
              <div className="relative h-4">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/70" />
                {ticks.map((tick) => (
                  <div
                    key={tick}
                    className="absolute inset-y-0 w-px bg-border/50"
                    style={{ left: `${tick * 100}%` }}
                  />
                ))}
                {row.attempts.map((attempt, index) => {
                  const from = time(attempt.startedAt) ?? start;
                  const left = pct(from);
                  const isRunning = attempt.status === "running";
                  const to = isRunning
                    ? now
                    : (time(attempt.finishedAt) ?? from + (attempt.durationMs ?? 0));
                  const width = Math.max(pct(to) - left, 0);
                  const tone = runStatusTone(attempt.status);
                  const earlier = index < row.attempts.length - 1;
                  const label = `${row.label}, Versuch ${attempt.attempt}: ${runStatusLabel(attempt.status)}`;
                  const bar = isRunning ? (
                    <span
                      role="img"
                      aria-label={label}
                      className="absolute top-1/2 h-2 -translate-y-1/2"
                      style={{ left: `${left}%`, right: 0 }}
                    >
                      <span
                        className="block h-full w-full origin-left rounded-full bg-primary transition-transform duration-1000 ease-linear motion-reduce:transition-none"
                        style={{
                          transform: `scaleX(${Math.min(1, Math.max(0.004, width / Math.max(100 - left, 0.0001)))})`,
                        }}
                      />
                    </span>
                  ) : (
                    <span
                      role="img"
                      aria-label={label}
                      className={cn(
                        "absolute top-1/2 h-2 min-w-1 -translate-y-1/2 rounded-full before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
                        BAR[tone],
                        earlier && "opacity-45",
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                  return (
                    <Tooltip key={attempt.seq}>
                      <TooltipTrigger asChild>{bar}</TooltipTrigger>
                      <TooltipContent side="top" className="max-w-sm flex-col items-start gap-0.5">
                        <span className="font-medium">
                          {row.label}
                          {row.attempts.length > 1 && ` · Versuch ${attempt.attempt}`}
                        </span>
                        <span className="opacity-80">
                          {runStatusLabel(attempt.status)} ·{" "}
                          {formatDuration(isRunning ? now - from : attempt.durationMs)}
                          {attempt.rows != null &&
                            ` · ${attempt.rows.toLocaleString("de-DE")} Zeilen`}
                          {attempt.rowsAffected != null &&
                            ` · ${attempt.rowsAffected.toLocaleString("de-DE")} betroffen`}
                        </span>
                        {(attempt.error ?? attempt.message) && (
                          <span className="line-clamp-3 opacity-80">
                            {attempt.error ?? attempt.message}
                          </span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <span
                className={cn(
                  "text-right text-xs tabular-nums",
                  running ? "text-primary" : "text-muted-foreground",
                )}
              >
                {formatDuration(duration)}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
