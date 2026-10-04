import { CalendarClockIcon, CircleAlertIcon, ZapIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { describeSchedule } from "@/lib/automation/schedule-text";
import { validTimeZone } from "@/lib/automation/validation";
import { previewAutomationSchedule, type Schedule } from "@/lib/db/automation";
import { cn } from "@/lib/utils";

interface Props {
  schedule: Schedule;
  taskNames: Record<string, string>;
  blocked?: string | null;
}

function formatRun(date: Date, timeZone: string | null): { day: string; time: string } {
  const zone = timeZone && validTimeZone(timeZone) ? { timeZone } : {};
  const parts = new Intl.DateTimeFormat("de-DE", {
    ...zone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    day: `${part("weekday").replace(".", "")}, ${part("day")}.${part("month")}.${part("year")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}
const RELATIVE = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });

function relative(date: Date, now: number): string {
  const minutes = Math.round((date.getTime() - now) / 60_000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return RELATIVE.format(hours, "hour");
  return RELATIVE.format(Math.round(hours / 24), "day");
}

function eventText(schedule: Schedule, taskNames: Record<string, string>): string | null {
  const trigger = schedule.trigger;
  if (trigger.type === "app_start")
    return "Läuft bei jedem Start von l8db, nicht im Hintergrundmodus.";
  if (trigger.type === "after_task")
    return trigger.taskId
      ? `Läuft, sobald „${taskNames[trigger.taskId] ?? trigger.taskId}“ fertig ist.`
      : "Wähle den Task, auf den dieser folgen soll.";
  return null;
}

type State =
  | { status: "loading" }
  | { status: "ready"; runs: string[] }
  | { status: "error"; message: string };

export function SchedulePreview({ schedule, taskNames, blocked }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [pending, setPending] = useState(false);
  const event = eventText(schedule, taskNames);
  const key = JSON.stringify(schedule);

  useEffect(() => {
    if (event || blocked) return;
    let alive = true;
    setPending(true);
    const timer = setTimeout(() => {
      previewAutomationSchedule(JSON.parse(key) as Schedule, 5)
        .then((runs) => alive && setState({ status: "ready", runs }))
        .catch((error) => alive && setState({ status: "error", message: String(error) }))
        .finally(() => alive && setPending(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, event, blocked]);

  const now = Date.now();

  return (
    <div
      data-testid="automation-schedule-preview"
      className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
    >
      <p className="flex items-start gap-2 text-sm font-medium text-pretty">
        <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {describeSchedule(schedule, taskNames)}
      </p>
      {event ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ZapIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          {event}
        </p>
      ) : blocked || state.status === "error" ? (
        <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          {blocked ?? (state.status === "error" ? state.message : "")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Nächste Läufe</p>
          {state.status === "ready" && state.runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Keine Termine – liegt alles in der Vergangenheit oder außerhalb des Zeitraums?
            </p>
          ) : (
            <ol
              aria-busy={pending}
              className={cn(
                "flex flex-col transition-opacity duration-150",
                pending && "opacity-50",
              )}
            >
              {(state.status === "ready" ? state.runs : Array.from({ length: 5 }, () => "")).map(
                (run, index) => {
                  const date = run ? new Date(run) : null;
                  const label = date ? formatRun(date, schedule.timezone) : null;
                  return (
                    <li
                      key={run || index}
                      className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-b border-dashed border-border/70 py-1.5 text-[13px] tabular-nums last:border-b-0"
                    >
                      {date && label ? (
                        <>
                          <span>{label.day}</span>
                          <span className="font-medium">{label.time}</span>
                          <span className="w-24 text-right text-xs text-muted-foreground">
                            {relative(date, now)}
                          </span>
                        </>
                      ) : (
                        <span className="col-span-3 h-4 w-40 rounded bg-muted" />
                      )}
                    </li>
                  );
                },
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
