import type { Action, NotificationRule, Schedule, Step, Task, Trigger } from "@/lib/db/automation";
import { newNotification, newSchedule, newStep, newTask } from "./defaults";

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  build(): Task;
}

function step<T extends Action["type"]>(
  type: T,
  name: string,
  patch: Partial<Extract<Action, { type: T }>> = {},
  flow: Partial<Step> = {},
): Step {
  const base = newStep(type);
  return { ...base, ...flow, name, action: { ...base.action, ...patch } as Action };
}

function schedule(trigger: Trigger, patch: Partial<Schedule> = {}): Schedule {
  return { ...newSchedule(trigger.type), trigger, ...patch };
}

function rule(patch: Partial<NotificationRule>): NotificationRule {
  return { ...newNotification(), ...patch };
}

function task(name: string, patch: Partial<Task>): Task {
  return { ...newTask(name), ...patch };
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "nightly-backup",
    name: "Nächtliches Backup mit Aufräumen",
    description: "Sichert jede Nacht um 02:00 und behält die letzten 14 Sicherungen.",
    build: () =>
      task("Nächtliches Backup", {
        folder: "Wartung",
        tags: ["backup"],
        description: "Sichert die Datenbank jede Nacht und räumt alte Sicherungen auf.",
        background: true,
        steps: [
          step("backup", "Datenbank sichern", {
            output: {
              path: "${output_dir}/backups/${connection|filename}.dump",
              appendTimestamp: true,
              ifExists: "rename",
              zip: false,
              cleanup: { olderThanDays: 30, keepLast: 14 },
            },
          }),
        ],
        schedules: [schedule({ type: "daily", times: ["02:00"] })],
        notifications: [rule({ when: "failure" })],
      }),
  },
  {
    id: "daily-csv-report",
    name: "Täglicher CSV-Bericht per E-Mail",
    description: "Exportiert werktags um 07:00 eine Abfrage und verschickt sie als Anhang.",
    build: () =>
      task("Täglicher CSV-Bericht", {
        folder: "Berichte",
        tags: ["bericht"],
        description: "Exportiert die Umsätze von gestern als CSV und verschickt sie per E-Mail.",
        steps: [
          step("export", "Umsätze exportieren", {
            source: {
              type: "query",
              sql: "SELECT *\nFROM orders\nWHERE created_at >= '${date-1d}'\n  AND created_at < '${date}'",
            },
            format: "csv",
            output: {
              path: "${output_dir}/berichte/umsatz-${date-1d}.csv",
              appendTimestamp: false,
              ifExists: "overwrite",
              zip: false,
              cleanup: { olderThanDays: 90, keepLast: null },
            },
          }),
        ],
        schedules: [schedule({ type: "weekly", weekdays: [1, 2, 3, 4, 5], times: ["07:00"] })],
        notifications: [
          rule({
            when: "success",
            channel: { type: "email", profileId: "", to: [], cc: [] },
            title: "Umsatzbericht ${date-1d}",
            body: "Im Anhang der Bericht für ${date-1d}.\n\n${run.summary}",
            attachOutputs: true,
            skipIfEmpty: true,
          }),
          rule({ when: "failure" }),
        ],
      }),
  },
  {
    id: "query-alert",
    name: "Abfrage-Alarm",
    description: "Prüft alle 15 Minuten eine Abfrage und meldet sich nur bei Zustandswechseln.",
    build: () =>
      task("Abfrage-Alarm", {
        folder: "Überwachung",
        tags: ["alarm"],
        description: "Meldet hängende Bestellungen, solange welche existieren.",
        steps: [
          step("alert", "Hängende Bestellungen", {
            sql: "SELECT id, created_at\nFROM orders\nWHERE status = 'pending'\n  AND created_at < now() - interval '1 hour'",
            condition: { type: "has_rows" },
            rearmMinutes: 240,
            notifyOnResolve: true,
          }),
        ],
        schedules: [schedule({ type: "interval", every: 15, unit: "minutes" })],
        notifications: [rule({ when: "alert_triggered" }), rule({ when: "alert_resolved" })],
      }),
  },
  {
    id: "data-quality",
    name: "Datenqualität prüfen",
    description: "Prüft werktags Zeilenzahl, Pflichtfelder, Eindeutigkeit und Aktualität.",
    build: () =>
      task("Datenqualität prüfen", {
        folder: "Überwachung",
        tags: ["qualität"],
        description: "Bricht ab, sobald eine Prüfung mit Schwere „Fehler“ verletzt ist.",
        variables: [
          {
            name: "schema",
            kind: "text",
            defaultValue: "public",
            choices: [],
            prompt: false,
            description: "Schema der geprüften Tabelle",
          },
          {
            name: "tabelle",
            kind: "text",
            defaultValue: "orders",
            choices: [],
            prompt: false,
            description: "Geprüfte Tabelle",
          },
        ],
        steps: [
          step("check", "Tabelle ist nicht leer", {
            check: {
              type: "row_count",
              schema: "${schema}",
              table: "${tabelle}",
              sql: null,
              op: "gt",
              value: 0,
            },
          }),
          step(
            "check",
            "IDs sind gesetzt",
            {
              check: { type: "not_null", schema: "${schema}", table: "${tabelle}", column: "id" },
            },
            { onFailure: { type: "next" } },
          ),
          step("check", "IDs sind eindeutig", {
            check: { type: "unique", schema: "${schema}", table: "${tabelle}", columns: ["id"] },
          }),
          step("check", "Daten sind aktuell", {
            check: {
              type: "freshness",
              schema: "${schema}",
              table: "${tabelle}",
              column: "updated_at",
              warnAfterMinutes: 60,
              errorAfterMinutes: 240,
            },
            severity: "warning",
          }),
        ],
        schedules: [schedule({ type: "weekly", weekdays: [1, 2, 3, 4, 5], times: ["06:30"] })],
        notifications: [rule({ when: "failure" }), rule({ when: "warning" })],
      }),
  },
  {
    id: "mirror-table",
    name: "Tabelle spiegeln",
    description:
      "Kopiert stündlich eine Tabelle in eine zweite Verbindung (leeren und neu füllen).",
    build: () =>
      task("Tabelle spiegeln", {
        folder: "Daten",
        tags: ["spiegel"],
        steps: [
          step("table_copy", "Bestellungen spiegeln", {
            tables: [
              { schema: "public", table: "orders", targetSchema: "public", targetTable: "orders" },
            ],
            mode: "truncate",
          }),
        ],
        schedules: [
          schedule(
            { type: "interval", every: 1, unit: "hours" },
            { window: { from: "06:00", to: "22:00" } },
          ),
        ],
        notifications: [rule({ when: "failure" })],
      }),
  },
  {
    id: "script-by-tag",
    name: "Skript auf allen Verbindungen mit Tag",
    description: "Führt ein Wartungsskript auf jeder Verbindung mit dem Tag „wartung“ aus.",
    build: () => {
      const inner = step("sql", "Statistiken aktualisieren", {
        connections: ["${server}"],
        sql: "ANALYZE;",
      });
      return task("Wartung auf allen Servern", {
        folder: "Wartung",
        tags: ["wartung"],
        description: "Fehler auf einem Server stoppen die übrigen nicht.",
        steps: [
          step("loop", "Für jede Verbindung", {
            over: { type: "connections", connections: [], tag: "wartung" },
            item: "server",
            steps: [inner],
            continueOnError: true,
          }),
        ],
        schedules: [schedule({ type: "weekly", weekdays: [7], times: ["03:00"] })],
        notifications: [rule({ when: "failure" })],
      });
    },
  },
  {
    id: "webhook-on-failure",
    name: "Webhook bei Fehler",
    description:
      "Führt ein Skript aus und meldet Fehler an Slack, Teams, Discord oder einen Webhook.",
    build: () =>
      task("Skript mit Webhook-Meldung", {
        folder: "Wartung",
        steps: [
          step("sql", "Skript ausführen", {
            sql: "DELETE FROM sessions\nWHERE expires_at < now();",
          }),
        ],
        schedules: [schedule({ type: "daily", times: ["04:00"] })],
        notifications: [
          rule({
            when: "failure",
            channel: { type: "webhook", webhookId: "" },
            title: "✕ ${task} fehlgeschlagen",
            body: "Fehler: ${run.error}",
          }),
        ],
      }),
  },
];
