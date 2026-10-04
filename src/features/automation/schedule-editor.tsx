import {
  CalendarDaysIcon,
  CalendarIcon,
  CalendarRangeIcon,
  ChevronDownIcon,
  Clock3Icon,
  CodeXmlIcon,
  type LucideIcon,
  PlayIcon,
  RepeatIcon,
  Rows3Icon,
  WorkflowIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { newTrigger } from "@/lib/automation/defaults";
import { TRIGGER_LABELS } from "@/lib/automation/labels";
import { NTH_LABELS, systemTimeZone, WEEKDAYS } from "@/lib/automation/schedule-text";
import { DATE_PATTERN } from "@/lib/automation/validation";
import type {
  AfterOutcome,
  IntervalUnit,
  Schedule,
  Task,
  TaskSummary,
  Trigger,
  ValidationIssue,
} from "@/lib/db/automation";
import { cn } from "@/lib/utils";
import { ChipsInput } from "./chips-input";
import { FormRow } from "./form-row";
import { KeyValueFields } from "./key-value-fields";
import { SchedulePreview } from "./schedule-preview";
import { TimeListInput } from "./time-list-input";
import { WeekdayPicker } from "./weekday-picker";

interface Props {
  schedule: Schedule;
  task: Task;
  tasks: TaskSummary[];
  issues: ValidationIssue[];
  onChange: (schedule: Schedule) => void;
}

const KINDS: { type: Trigger["type"]; icon: LucideIcon }[] = [
  { type: "daily", icon: CalendarIcon },
  { type: "weekly", icon: CalendarRangeIcon },
  { type: "monthly", icon: CalendarDaysIcon },
  { type: "interval", icon: RepeatIcon },
  { type: "monthly_nth", icon: Rows3Icon },
  { type: "once", icon: Clock3Icon },
  { type: "cron", icon: CodeXmlIcon },
  { type: "app_start", icon: PlayIcon },
  { type: "after_task", icon: WorkflowIcon },
];

const UNITS: { value: IntervalUnit; label: string }[] = [
  { value: "minutes", label: "Minuten" },
  { value: "hours", label: "Stunden" },
  { value: "days", label: "Tage" },
];

const OUTCOMES: { value: AfterOutcome; label: string }[] = [
  { value: "success", label: "Bei Erfolg" },
  { value: "failure", label: "Bei Fehler" },
  { value: "always", label: "Immer" },
];

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

function keepTimes(previous: Trigger, next: Trigger): Trigger {
  if ("times" in previous && "times" in next && previous.times.length)
    return { ...next, times: previous.times };
  return next;
}

export function ScheduleEditor({ schedule, task, tasks, issues, onChange }: Props) {
  const [advanced, setAdvanced] = useState(
    Boolean(
      schedule.timezone ||
        schedule.startAt ||
        schedule.endAt ||
        schedule.exclusions.length ||
        schedule.window ||
        schedule.environment ||
        Object.keys(schedule.vars).length,
    ),
  );
  const advancedId = useId();
  const error = (field: string) =>
    issues.find(
      (issue) => issue.severity === "error" && issue.field === `schedules.${schedule.id}.${field}`,
    )?.message ?? null;
  const firstError =
    issues.find(
      (issue) => issue.severity === "error" && issue.field.startsWith(`schedules.${schedule.id}.`),
    )?.message ?? null;
  const trigger = schedule.trigger;
  const setTrigger = (next: Trigger) => onChange({ ...schedule, trigger: next });
  const taskNames = Object.fromEntries(tasks.map((entry) => [entry.task.id, entry.task.name]));
  const system = systemTimeZone();

  return (
    <div className="flex flex-col gap-5">
      <fieldset
        aria-label="Art des Zeitplans"
        className="m-0 grid min-w-0 grid-cols-2 gap-1.5 border-0 p-0 @md/tab:grid-cols-3"
      >
        {KINDS.map(({ type, icon: Icon }) => {
          const active = trigger.type === type;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => !active && setTrigger(keepTimes(trigger, newTrigger(type)))}
              className={cn(
                "flex h-9 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-[background-color,border-color,color,scale] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96] motion-reduce:active:scale-100",
                active
                  ? "border-primary/40 bg-primary/8 text-foreground"
                  : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
              <span className="truncate">{TRIGGER_LABELS[type]}</span>
            </button>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-4">
        {trigger.type === "interval" && (
          <FormRow label="Alle" error={error("every")} bind={false}>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                aria-label="Intervall"
                value={trigger.every || ""}
                onChange={(event) => setTrigger({ ...trigger, every: Number(event.target.value) })}
                className="w-24"
              />
              <div className="w-64">
                <SegmentedControl
                  label="Einheit"
                  value={trigger.unit}
                  options={UNITS}
                  onChange={(unit) => setTrigger({ ...trigger, unit })}
                />
              </div>
            </div>
          </FormRow>
        )}
        {trigger.type === "weekly" && (
          <FormRow label="An" error={error("weekdays")} bind={false}>
            <WeekdayPicker
              value={trigger.weekdays}
              invalid={Boolean(error("weekdays"))}
              onChange={(weekdays) => setTrigger({ ...trigger, weekdays })}
            />
          </FormRow>
        )}
        {trigger.type === "monthly" && (
          <FormRow
            label="Am"
            error={error("days")}
            hint="Tage, die ein Monat nicht hat, werden übersprungen."
            bind={false}
          >
            <div className="flex flex-col gap-2">
              <fieldset
                aria-label="Tage im Monat"
                className="m-0 grid w-fit min-w-0 grid-cols-7 gap-1 border-0 p-0"
              >
                {MONTH_DAYS.map((day) => {
                  const on = trigger.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setTrigger({
                          ...trigger,
                          days: on
                            ? trigger.days.filter((entry) => entry !== day)
                            : [...trigger.days, day].sort((a, b) => a - b),
                        })
                      }
                      className="size-8 rounded-lg text-xs tabular-nums text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-primary-foreground"
                    >
                      {day}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={trigger.lastDay}
                  onClick={() => setTrigger({ ...trigger, lastDay: !trigger.lastDay })}
                  className="col-span-3 h-8 rounded-lg text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-primary-foreground"
                >
                  Letzter Tag
                </button>
              </fieldset>
            </div>
          </FormRow>
        )}
        {trigger.type === "monthly_nth" && (
          <FormRow label="Am" bind={false}>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(trigger.nth)}
                onValueChange={(nth) => setTrigger({ ...trigger, nth: Number(nth) })}
              >
                <SelectTrigger aria-label="Welcher" className="w-36 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, -1].map((nth) => (
                    <SelectItem key={nth} value={String(nth)}>
                      {NTH_LABELS[nth].replace(/^./, (char) => char.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(trigger.weekday)}
                onValueChange={(weekday) => setTrigger({ ...trigger, weekday: Number(weekday) })}
              >
                <SelectTrigger aria-label="Wochentag" className="w-40 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day) => (
                    <SelectItem key={day.value} value={String(day.value)}>
                      {day.long}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">im Monat</span>
            </div>
          </FormRow>
        )}
        {"times" in trigger && (
          <FormRow
            label="Um"
            error={error("times")}
            hint="Mehrere Uhrzeiten mit Komma oder Enter trennen."
            className="max-w-md"
          >
            <TimeListInput
              value={trigger.times}
              onChange={(times) => setTrigger({ ...trigger, times })}
            />
          </FormRow>
        )}
        {trigger.type === "cron" && (
          <FormRow
            label="Cron-Ausdruck"
            error={error("expression")}
            hint="5 Felder (Minute Stunde Tag Monat Wochentag) oder 6 mit Sekunden vorn. L, # und W werden unterstützt."
            className="max-w-md"
          >
            <Input
              value={trigger.expression}
              onChange={(event) => setTrigger({ ...trigger, expression: event.target.value })}
              spellCheck={false}
              className="font-mono text-[13px]"
              placeholder="0 9 * * 1-5"
            />
          </FormRow>
        )}
        {trigger.type === "once" && (
          <FormRow label="Am" error={error("at")} className="max-w-64">
            <Input
              type="datetime-local"
              value={trigger.at}
              onChange={(event) => setTrigger({ ...trigger, at: event.target.value })}
            />
          </FormRow>
        )}
        {trigger.type === "app_start" && (
          <FormRow
            label="Verzögerung"
            hint="Sekunden nach dem Start, damit Verbindungen bereit sind."
            className="max-w-48"
          >
            <Input
              type="number"
              min={0}
              value={trigger.delaySeconds}
              onChange={(event) =>
                setTrigger({ ...trigger, delaySeconds: Math.max(0, Number(event.target.value)) })
              }
            />
          </FormRow>
        )}
        {trigger.type === "after_task" && (
          <div className="flex flex-wrap items-start gap-4">
            <FormRow label="Nach" error={error("taskId")} className="w-72">
              <Select
                value={trigger.taskId}
                onValueChange={(taskId) => setTrigger({ ...trigger, taskId })}
              >
                <SelectTrigger className="w-full rounded-lg">
                  <SelectValue placeholder="Task wählen" />
                </SelectTrigger>
                <SelectContent searchable>
                  {tasks
                    .filter((entry) => entry.task.id !== task.id)
                    .map((entry) => (
                      <SelectItem key={entry.task.id} value={entry.task.id}>
                        {entry.task.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Wenn" bind={false} className="w-72">
              <SegmentedControl
                label="Wenn"
                value={trigger.on}
                options={OUTCOMES}
                onChange={(on) => setTrigger({ ...trigger, on })}
              />
            </FormRow>
          </div>
        )}
      </div>

      <SchedulePreview schedule={schedule} taskNames={taskNames} blocked={firstError} />

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls={advancedId}
          onClick={() => setAdvanced((open) => !open)}
          className="flex w-fit items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
              !advanced && "-rotate-90",
            )}
            aria-hidden
          />
          Erweitert: Zeitzone, Zeitraum, Ausnahmen, Umgebung
        </button>
        {advanced && (
          <div
            id={advancedId}
            className="mt-4 grid gap-4 animate-in duration-200 fade-in-0 slide-in-from-top-1 motion-reduce:slide-in-from-top-0 @xl/tab:grid-cols-2"
          >
            <FormRow
              label="Zeitzone"
              error={error("timezone")}
              hint={`Leer = Zeitzone dieses Rechners (${system}).`}
            >
              <Select
                value={schedule.timezone ?? "__system"}
                onValueChange={(zone) =>
                  onChange({ ...schedule, timezone: zone === "__system" ? null : zone })
                }
              >
                <SelectTrigger className="w-full rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent searchable>
                  <SelectItem value="__system">Wie dieser Rechner</SelectItem>
                  {schedule.timezone && !ZONES.includes(schedule.timezone) && (
                    <SelectItem value={schedule.timezone}>{schedule.timezone}</SelectItem>
                  )}
                  {ZONES.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            {trigger.type === "interval" ? (
              <FormRow
                label="Nur zwischen"
                error={error("window")}
                hint="Liegt „bis“ vor „von“, geht das Fenster über Mitternacht."
                bind={false}
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label="Von"
                    value={schedule.window?.from ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...schedule,
                        window: event.target.value
                          ? { from: event.target.value, to: schedule.window?.to ?? "18:00" }
                          : null,
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">bis</span>
                  <Input
                    type="time"
                    aria-label="Bis"
                    value={schedule.window?.to ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...schedule,
                        window: event.target.value
                          ? { from: schedule.window?.from ?? "08:00", to: event.target.value }
                          : null,
                      })
                    }
                  />
                </div>
              </FormRow>
            ) : (
              <div className="hidden @xl/tab:block" />
            )}
            <FormRow label="Gültig ab" hint="Leer = sofort.">
              <Input
                type="datetime-local"
                value={schedule.startAt ?? ""}
                onChange={(event) => onChange({ ...schedule, startAt: event.target.value || null })}
              />
            </FormRow>
            <FormRow label="Gültig bis" error={error("endAt")} hint="Leer = unbegrenzt.">
              <Input
                type="datetime-local"
                value={schedule.endAt ?? ""}
                onChange={(event) => onChange({ ...schedule, endAt: event.target.value || null })}
              />
            </FormRow>
            <FormRow
              label="Ausnahmen"
              error={error("exclusions")}
              hint="Tage ohne Lauf, z. B. Feiertage (JJJJ-MM-TT)."
            >
              <ChipsInput
                value={schedule.exclusions}
                onChange={(exclusions) =>
                  onChange({ ...schedule, exclusions: [...exclusions].sort() })
                }
                validate={(value) =>
                  DATE_PATTERN.test(value) ? null : `„${value}“ ist kein Datum (JJJJ-MM-TT).`
                }
                separators={/[,;\s]+/}
                itemLabel="Ausnahme"
                placeholder="2026-12-24"
                mono
              />
            </FormRow>
            <FormRow
              label="Umgebung"
              error={error("environment")}
              hint={
                task.environments.length
                  ? "Welche Umgebung dieser Zeitplan nutzt."
                  : "Lege Umgebungen im Tab „Variablen“ an."
              }
            >
              <Select
                value={schedule.environment ?? "__default"}
                disabled={!task.environments.length}
                onValueChange={(name) =>
                  onChange({ ...schedule, environment: name === "__default" ? null : name })
                }
              >
                <SelectTrigger className="w-full rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">
                    Standard{task.defaultEnvironment ? ` (${task.defaultEnvironment})` : ""}
                  </SelectItem>
                  {task.environments.map((env) => (
                    <SelectItem key={env.name} value={env.name}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <div className="@xl/tab:col-span-2">
              <FormRow
                label="Variablen für diesen Zeitplan"
                hint="Überschreiben Standardwerte und Umgebung nur bei Läufen dieses Zeitplans."
                bind={false}
              >
                <KeyValueFields
                  value={schedule.vars}
                  onChange={(vars) => onChange({ ...schedule, vars })}
                  keyLabel="Variable"
                  valueLabel="Wert"
                  keyPlaceholder="name"
                  valuePlaceholder="Wert"
                  addLabel="Wert hinzufügen"
                />
              </FormRow>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
