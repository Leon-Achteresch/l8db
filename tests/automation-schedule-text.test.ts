import { describe, expect, test } from "bun:test";
import { describeSchedule } from "../src/lib/automation/schedule-text";
import type { Schedule, Trigger } from "../src/lib/db/automation";

const SYSTEM = "Europe/Berlin";

function schedule(trigger: Trigger, patch: Partial<Schedule> = {}): Schedule {
  return {
    id: "s",
    enabled: true,
    trigger,
    timezone: null,
    startAt: null,
    endAt: null,
    exclusions: [],
    window: null,
    vars: {},
    environment: null,
    ...patch,
  };
}

const names = { "task-backup": "Backup" };

const cases: [string, Schedule][] = [
  ["Alle 15 Minuten", schedule({ type: "interval", every: 15, unit: "minutes" })],
  [
    "Alle 15 Minuten zwischen 08:00 und 18:00",
    schedule(
      { type: "interval", every: 15, unit: "minutes" },
      { window: { from: "08:00", to: "18:00" } },
    ),
  ],
  ["Täglich um 06:00", schedule({ type: "daily", times: ["06:00"] })],
  ["Täglich um 06:00 und 18:00", schedule({ type: "daily", times: ["18:00", "06:00"] })],
  [
    "Jeden Montag und Donnerstag um 07:30",
    schedule({ type: "weekly", weekdays: [4, 1], times: ["07:30"] }),
  ],
  ["Werktags um 09:00", schedule({ type: "weekly", weekdays: [1, 2, 3, 4, 5], times: ["09:00"] })],
  [
    "Monatlich am 1. und 15. um 02:00",
    schedule({ type: "monthly", days: [1, 15], lastDay: false, times: ["02:00"] }),
  ],
  [
    "Monatlich am letzten Tag um 23:00",
    schedule({ type: "monthly", days: [], lastDay: true, times: ["23:00"] }),
  ],
  [
    "Jeden ersten Montag im Monat um 08:00",
    schedule({ type: "monthly_nth", nth: 1, weekday: 1, times: ["08:00"] }),
  ],
  [
    "Jeden letzten Freitag im Monat um 17:00",
    schedule({ type: "monthly_nth", nth: -1, weekday: 5, times: ["17:00"] }),
  ],
  ["Cron: 0 */2 * * *", schedule({ type: "cron", expression: "0 */2 * * *" })],
  ["Einmalig am 24.12.2026 um 10:00", schedule({ type: "once", at: "2026-12-24T10:00" })],
  ["Beim Start von l8db (nach 30 s)", schedule({ type: "app_start", delaySeconds: 30 })],
  [
    "Nach „Backup“ bei Erfolg",
    schedule({ type: "after_task", taskId: "task-backup", on: "success" }),
  ],
  [
    "Nach „Backup“ bei Fehler",
    schedule({ type: "after_task", taskId: "task-backup", on: "failure" }),
  ],
  ["Nach „Backup“ immer", schedule({ type: "after_task", taskId: "task-backup", on: "always" })],
];

describe("describeSchedule", () => {
  test.each(cases)("%s", (expected, value) => {
    expect(describeSchedule(value, names, SYSTEM)).toBe(expected);
  });

  test("appends start, end, exclusions and foreign time zone", () => {
    const value = schedule(
      { type: "daily", times: ["06:00"] },
      {
        startAt: "2026-11-01T00:00",
        endAt: "2026-12-31T23:59",
        exclusions: ["2026-12-24", "2026-12-25", "2026-12-26"],
        timezone: "America/New_York",
      },
    );
    expect(describeSchedule(value, names, SYSTEM)).toBe(
      "Täglich um 06:00 · ab 01.11.2026 · bis 31.12.2026 · 3 Ausnahmen · America/New_York",
    );
  });

  test("omits the time zone when it equals the system zone", () => {
    const value = schedule({ type: "daily", times: ["06:00"] }, { timezone: "Europe/Berlin" });
    expect(describeSchedule(value, names, SYSTEM)).toBe("Täglich um 06:00");
    expect(
      describeSchedule(
        schedule({ type: "daily", times: ["06:00"] }, { timezone: "Europe/Berlin" }),
        names,
        "UTC",
      ),
    ).toBe("Täglich um 06:00 · Europe/Berlin");
  });

  test("single exclusion is singular", () => {
    const value = schedule({ type: "daily", times: ["06:00"] }, { exclusions: ["2026-12-25"] });
    expect(describeSchedule(value, names, SYSTEM)).toBe("Täglich um 06:00 · 1 Ausnahme");
  });
});
