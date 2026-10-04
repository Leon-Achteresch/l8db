import type { AfterOutcome, IntervalUnit, Schedule, Trigger } from "@/lib/db/automation";

export const WEEKDAYS = [
  { value: 1, short: "Mo", long: "Montag" },
  { value: 2, short: "Di", long: "Dienstag" },
  { value: 3, short: "Mi", long: "Mittwoch" },
  { value: 4, short: "Do", long: "Donnerstag" },
  { value: 5, short: "Fr", long: "Freitag" },
  { value: 6, short: "Sa", long: "Samstag" },
  { value: 7, short: "So", long: "Sonntag" },
] as const;

export const NTH_LABELS: Record<number, string> = {
  1: "ersten",
  2: "zweiten",
  3: "dritten",
  4: "vierten",
  [-1]: "letzten",
};

const UNITS: Record<IntervalUnit, [string, string]> = {
  minutes: ["Minute", "Minuten"],
  hours: ["Stunde", "Stunden"],
  days: ["Tag", "Tage"],
};

const OUTCOMES: Record<AfterOutcome, string> = {
  success: "bei Erfolg",
  failure: "bei Fehler",
  always: "immer",
};

export function joinGerman(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} und ${items.at(-1)}`;
}

function sortedTimes(times: string[]): string[] {
  return [...times].sort();
}

function at(times: string[]): string {
  return times.length ? ` um ${joinGerman(sortedTimes(times))}` : "";
}

function weekdayName(day: number): string {
  return WEEKDAYS.find((entry) => entry.value === day)?.long ?? String(day);
}

export function formatLocalDate(value: string): string {
  const [date] = value.split("T");
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function sameDays(days: number[], expected: number[]): boolean {
  const set = new Set(days);
  return set.size === expected.length && expected.every((day) => set.has(day));
}

function describeWeekly(weekdays: number[], times: string[]): string {
  if (sameDays(weekdays, [1, 2, 3, 4, 5])) return `Werktags${at(times)}`;
  if (sameDays(weekdays, [6, 7])) return `Am Wochenende${at(times)}`;
  if (sameDays(weekdays, [1, 2, 3, 4, 5, 6, 7])) return `Täglich${at(times)}`;
  const names = [...new Set(weekdays)].sort((a, b) => a - b).map(weekdayName);
  if (!names.length) return "Wöchentlich (kein Wochentag gewählt)";
  return `Jeden ${joinGerman(names)}${at(times)}`;
}

function describeMonthly(days: number[], lastDay: boolean, times: string[]): string {
  const parts = [...new Set(days)].sort((a, b) => a - b).map((day) => `${day}.`);
  if (lastDay) parts.push("letzten Tag");
  if (!parts.length) return "Monatlich (kein Tag gewählt)";
  return `Monatlich am ${joinGerman(parts)}${at(times)}`;
}

function describeInterval(every: number, unit: IntervalUnit): string {
  const [one, many] = UNITS[unit];
  if (every === 1) return unit === "days" ? "Jeden Tag" : `Jede ${one}`;
  return `Alle ${every} ${many}`;
}

export function describeTrigger(trigger: Trigger, taskNames: Record<string, string> = {}): string {
  switch (trigger.type) {
    case "interval":
      return describeInterval(trigger.every, trigger.unit);
    case "daily":
      return `Täglich${at(trigger.times)}`;
    case "weekly":
      return describeWeekly(trigger.weekdays, trigger.times);
    case "monthly":
      return describeMonthly(trigger.days, trigger.lastDay, trigger.times);
    case "monthly_nth":
      return `Jeden ${NTH_LABELS[trigger.nth] ?? `${trigger.nth}.`} ${weekdayName(trigger.weekday)} im Monat${at(trigger.times)}`;
    case "cron":
      return `Cron: ${trigger.expression.trim()}`;
    case "once": {
      const [, time] = trigger.at.split("T");
      return `Einmalig am ${formatLocalDate(trigger.at)}${time ? ` um ${time.slice(0, 5)}` : ""}`;
    }
    case "app_start":
      return trigger.delaySeconds > 0
        ? `Beim Start von l8db (nach ${trigger.delaySeconds} s)`
        : "Beim Start von l8db";
    case "after_task": {
      const name = taskNames[trigger.taskId] ?? (trigger.taskId || "…");
      return `Nach „${name}“ ${OUTCOMES[trigger.on]}`;
    }
  }
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function describeSchedule(
  schedule: Schedule,
  taskNames: Record<string, string> = {},
  systemZone: string = systemTimeZone(),
): string {
  let text = describeTrigger(schedule.trigger, taskNames);
  if (schedule.window && schedule.trigger.type === "interval") {
    text += ` zwischen ${schedule.window.from} und ${schedule.window.to}`;
  }
  if (schedule.startAt) text += ` · ab ${formatLocalDate(schedule.startAt)}`;
  if (schedule.endAt) text += ` · bis ${formatLocalDate(schedule.endAt)}`;
  const exclusions = schedule.exclusions.length;
  if (exclusions) text += ` · ${exclusions} ${exclusions === 1 ? "Ausnahme" : "Ausnahmen"}`;
  if (schedule.timezone && schedule.timezone !== systemZone) text += ` · ${schedule.timezone}`;
  return text;
}
