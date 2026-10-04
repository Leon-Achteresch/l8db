import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, CalendarOffIcon } from "lucide-react";
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatClock, formatDateTime, formatRelative } from "@/lib/automation/format";
import { useAutomationStore } from "@/lib/automation/store";
import { useNow } from "@/lib/automation/use-now";
import { automationNextRuns, listAutomationRuns } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./status-icon";

const HOURS = 24;
const SPAN = HOURS * 3_600_000;
const MAX_LANES = 8;
const DENSE = 36;
const HOUR = 3_600_000;

function hourTicks(start: number): number[] {
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  first.setHours(first.getHours() + 1);
  while (first.getHours() % 3 !== 0) first.setHours(first.getHours() + 1);
  const ticks: number[] = [];
  for (let at = first.getTime(); at < start + SPAN - HOUR; at += 3 * HOUR)
    if (at - start >= 1.5 * HOUR) ticks.push(at);
  return ticks;
}

export function PlanningOverview() {
  const tasks = useAutomationStore((state) => state.tasks);
  const select = useAutomationStore((state) => state.select);
  const setView = useAutomationStore((state) => state.setView);
  const selectRun = useAutomationStore((state) => state.selectRun);
  const now = useNow(60_000);
  const revision = useMemo(
    () => tasks.map((task) => `${task.task.id}:${task.task.revision}:${task.task.enabled}`).join(),
    [tasks],
  );
  const upcoming = useQuery({
    queryKey: ["automation", "next-runs", revision],
    queryFn: () => automationNextRuns(HOURS),
    refetchInterval: 60_000,
  });
  const lastRuns = useMemo(() => tasks.map((task) => task.state.lastRunId ?? "").join(), [tasks]);
  const failed = useQuery({
    queryKey: ["automation", "failed-runs", lastRuns],
    queryFn: () => listAutomationRuns({ statuses: ["failed", "timeout", "interrupted"], limit: 5 }),
  });

  const names = useMemo(
    () => new Map(tasks.map((task) => [task.task.id, task.task.name])),
    [tasks],
  );
  const start = now;
  const lanes = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const entry of upcoming.data ?? []) {
      const at = new Date(entry.at).getTime();
      if (!Number.isFinite(at) || at < start || at > start + SPAN) continue;
      grouped.set(entry.taskId, [...(grouped.get(entry.taskId) ?? []), at]);
    }
    return [...grouped.entries()]
      .map(([taskId, times]) => ({ taskId, times: times.sort((a, b) => a - b) }))
      .sort((a, b) => a.times[0] - b.times[0]);
  }, [upcoming.data, start]);
  const shown = lanes.slice(0, MAX_LANES);
  const agenda = useMemo(
    () =>
      lanes
        .flatMap((lane) => lane.times.slice(0, 3).map((at) => ({ taskId: lane.taskId, at })))
        .sort((a, b) => a.at - b.at)
        .slice(0, 8),
    [lanes],
  );
  const ticks = useMemo(() => hourTicks(start), [start]);
  const position = (at: number) => `${((at - start) / SPAN) * 100}%`;
  const enabled = tasks.filter((task) => task.task.enabled).length;
  const paused = tasks.length - enabled;

  return (
    <div
      className="@container h-full min-h-0 overflow-y-auto overscroll-contain"
      data-testid="automation-planning"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Als Nächstes</h2>
          <p className="text-sm text-muted-foreground">
            {enabled === 1 ? "1 aktiver Task" : `${enabled} aktive Tasks`}
            {paused > 0 && ` · ${paused} pausiert`}
            {agenda[0] && ` · nächster Lauf ${formatRelative(agenda[0].at, now)}`}
          </p>
        </div>

        <section aria-labelledby="planning-timeline" className="flex flex-col gap-3">
          <h3 id="planning-timeline" className="sr-only">
            Zeitachse der nächsten 24 Stunden
          </h3>
          {lanes.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
              <CalendarOffIcon aria-hidden className="size-4 shrink-0" />
              {upcoming.isLoading
                ? "Termine werden berechnet …"
                : "In den nächsten 24 Stunden ist nichts geplant."}
            </div>
          ) : (
            <div className="@container/plan rounded-xl border bg-card px-4 pt-3 pb-2 shadow-xs">
              <div className="grid grid-cols-[minmax(6rem,min(30%,11rem))_1fr] gap-x-4">
                <div />
                <div className="relative h-5 text-[10px] tabular-nums text-muted-foreground">
                  <span className="absolute top-0 left-0 whitespace-nowrap">Jetzt</span>
                  {ticks.map((at, index) => (
                    <span
                      key={at}
                      className={cn(
                        "absolute top-0 -translate-x-1/2 whitespace-nowrap",
                        index % 2 === 0 && "hidden @lg/plan:inline",
                      )}
                      style={{ left: position(at) }}
                    >
                      {formatClock(at)}
                    </span>
                  ))}
                </div>
                {shown.map((lane) => {
                  const name = names.get(lane.taskId) ?? "Unbekannter Task";
                  const dense = lane.times.length > DENSE;
                  return (
                    <div key={lane.taskId} className="contents">
                      <button
                        type="button"
                        onClick={() => select(lane.taskId)}
                        title={name}
                        className="truncate py-2 text-left text-xs font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {name}
                      </button>
                      <div className="relative h-8">
                        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                        {ticks.map((at) => (
                          <div
                            key={at}
                            className="absolute inset-y-1.5 w-px bg-border/60"
                            style={{ left: position(at) }}
                          />
                        ))}
                        {dense ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                role="img"
                                aria-label={`${name}: ${lane.times.length} Läufe bis ${formatClock(lane.times.at(-1))}`}
                                className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-fuchsia-500/35 ring-1 ring-fuchsia-500/50 before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
                                style={{
                                  left: position(lane.times[0]),
                                  right: `calc(100% - ${position(lane.times.at(-1) ?? lane.times[0])})`,
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              {lane.times.length} Läufe · {formatClock(lane.times[0])} bis{" "}
                              {formatClock(lane.times.at(-1))}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          lane.times.map((at) => (
                            <Tooltip key={at}>
                              <TooltipTrigger asChild>
                                <span
                                  role="img"
                                  aria-label={`${name}: ${formatDateTime(at)}`}
                                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-500 ring-2 ring-card before:absolute before:-inset-1.5 before:rounded-full before:content-['']"
                                  style={{ left: position(at) }}
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {formatDateTime(at)} · {formatRelative(at, now)}
                              </TooltipContent>
                            </Tooltip>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {lanes.length > MAX_LANES && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  + {lanes.length - MAX_LANES} weitere Tasks mit Terminen
                </p>
              )}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-8 @2xl:grid-cols-2">
          <section aria-labelledby="planning-agenda" className="flex flex-col gap-2">
            <h3 id="planning-agenda" className="text-[13px] font-semibold">
              Termine
            </h3>
            {agenda.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Keine Termine in den nächsten 24 Stunden.
              </p>
            ) : (
              <ol className="flex flex-col divide-y rounded-xl border">
                {agenda.map((entry) => (
                  <li key={`${entry.taskId}-${entry.at}`}>
                    <button
                      type="button"
                      onClick={() => select(entry.taskId)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      <span className="w-12 shrink-0 text-xs font-medium tabular-nums">
                        {formatClock(entry.at)}
                      </span>
                      <span
                        title={names.get(entry.taskId)}
                        className="min-w-0 flex-1 truncate text-[13px]"
                      >
                        {names.get(entry.taskId) ?? "Unbekannter Task"}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatRelative(entry.at, now)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="planning-failed" className="flex flex-col gap-2">
            <h3 id="planning-failed" className="text-[13px] font-semibold">
              Zuletzt fehlgeschlagen
            </h3>
            {(failed.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {failed.isLoading ? "Wird geladen …" : "Keine Fehler. Alles lief durch."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y rounded-xl border">
                {(failed.data ?? []).map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selectRun(run.id);
                        setView("history");
                      }}
                      className="group/failed flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      <StatusIcon status={run.status} className="mt-0.5" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span title={run.taskName} className="truncate text-[13px] font-medium">
                          {run.taskName}
                        </span>
                        <span
                          title={run.error ?? undefined}
                          className="line-clamp-2 text-xs text-muted-foreground"
                        >
                          {run.error ?? "Ohne Fehlermeldung"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                        {formatRelative(run.startedAt, now)}
                        <ArrowRightIcon
                          aria-hidden
                          className="size-3 opacity-0 transition-opacity group-hover/failed:opacity-100 group-focus-visible/failed:opacity-100"
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
