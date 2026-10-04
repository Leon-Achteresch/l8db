import { CalendarClockIcon, ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { newSchedule } from "@/lib/automation/defaults";
import { describeSchedule } from "@/lib/automation/schedule-text";
import { toast } from "@/lib/automation/toast";
import type { Schedule, Task, TaskSummary, ValidationIssue } from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { ScheduleEditor } from "./schedule-editor";

interface Props {
  task: Task;
  tasks: TaskSummary[];
  issues: ValidationIssue[];
  onChange: (schedules: Schedule[]) => void;
}

export function ScheduleTab({ task, tasks, issues, onChange }: Props) {
  const [openId, setOpenId] = useState<string | null>(
    task.schedules.length === 1 ? task.schedules[0].id : null,
  );
  const taskNames = Object.fromEntries(tasks.map((entry) => [entry.task.id, entry.task.name]));
  const update = (schedule: Schedule) =>
    onChange(task.schedules.map((entry) => (entry.id === schedule.id ? schedule : entry)));
  const add = () => {
    const schedule = newSchedule();
    onChange([...task.schedules, schedule]);
    setOpenId(schedule.id);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 pt-5 pb-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold tracking-tight">Zeitpläne</h3>
          <p className="max-w-prose text-xs text-pretty text-muted-foreground">
            Wann der Task von selbst läuft. Mehrere Zeitpläne ergänzen sich, z. B. werktags früh und
            zusätzlich am Monatsende.
          </p>
        </div>
        {task.schedules.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PlusIcon />
            Zeitplan
          </Button>
        )}
      </header>

      {!task.enabled && task.schedules.some((schedule) => schedule.enabled) && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-pretty text-muted-foreground">
          Der Task ist pausiert. Zeitpläne greifen erst, wenn er oben aktiviert ist.
        </p>
      )}

      {task.schedules.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
            <CalendarClockIcon className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Läuft nur auf Knopfdruck</p>
            <p className="max-w-prose text-xs text-pretty text-muted-foreground">
              Ohne Zeitplan startest du den Task mit „Ausführen“, per Kommandozeile oder aus einem
              anderen Task.
            </p>
          </div>
          <Button type="button" size="sm" onClick={add}>
            <PlusIcon />
            Zeitplan hinzufügen
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {task.schedules.map((schedule) => {
            const open = openId === schedule.id;
            const failing = issues.some(
              (issue) =>
                issue.severity === "error" && issue.field.startsWith(`schedules.${schedule.id}.`),
            );
            return (
              <li
                key={schedule.id}
                className={cn(
                  "rounded-xl border bg-card transition-shadow duration-200",
                  open && "shadow-sm",
                )}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Switch
                    checked={schedule.enabled}
                    onCheckedChange={(enabled) => update({ ...schedule, enabled })}
                    aria-label={schedule.enabled ? "Zeitplan pausieren" : "Zeitplan aktivieren"}
                  />
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : schedule.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[13px] font-medium",
                        !schedule.enabled && "text-muted-foreground",
                      )}
                    >
                      {describeSchedule(schedule, taskNames)}
                    </span>
                    {failing && (
                      <span className="shrink-0 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                        Unvollständig
                      </span>
                    )}
                    <ChevronDownIcon
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                        open && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Zeitplan entfernen"
                    onClick={() => {
                      const previous = task.schedules;
                      onChange(previous.filter((entry) => entry.id !== schedule.id));
                      toast("Zeitplan entfernt", {
                        action: { label: "Rückgängig", onClick: () => onChange(previous) },
                      });
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                {open && (
                  <div className="border-t px-4 pt-4 pb-5 animate-in duration-200 fade-in-0 slide-in-from-top-1 motion-reduce:slide-in-from-top-0">
                    <ScheduleEditor
                      schedule={schedule}
                      task={task}
                      tasks={tasks}
                      issues={issues}
                      onChange={update}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
