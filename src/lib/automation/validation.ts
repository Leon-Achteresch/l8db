import type {
  Action,
  ChannelRef,
  Flow,
  OutputSpec,
  Schedule,
  Severity,
  Step,
  Task,
  ValidationIssue,
} from "@/lib/db/automation";
import { findPlaceholders, isBuiltinPlaceholder, unsafeSqlPlaceholders } from "./placeholders";

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APPEND_FORMATS = new Set(["csv", "tsv", "jsonl", "markdown", "sql"]);

export const CONNECTION_FIELDS = new Set([
  "connection",
  "connections",
  "source",
  "target",
  "left.connection",
  "right.connection",
  "over.connection",
  "query.connection",
]);

export function isConnectionIssue(issue: ValidationIssue): boolean {
  return CONNECTION_FIELDS.has(issue.field);
}

type Push = (field: string, message: string, severity?: Severity) => void;

function blank(value: string | null | undefined): boolean {
  return !value?.trim();
}

export function timeError(value: string): string | null {
  return TIME_PATTERN.test(value) ? null : `„${value}“ ist keine Uhrzeit (HH:MM).`;
}

function requireText(push: Push, field: string, value: string | null | undefined, label: string) {
  if (blank(value)) push(field, `${label} fehlt.`);
}

function checkOutput(push: Push, output: OutputSpec, field = "output") {
  requireText(push, `${field}.path`, output.path, "Zielpfad");
  const cleanup = output.cleanup;
  if (cleanup && cleanup.olderThanDays === null && cleanup.keepLast === null) {
    push(`${field}.cleanup`, "Aufräumen braucht ein Alter oder eine Anzahl.", "warning");
  }
}

export function channelIssues(channel: ChannelRef): { field: string; message: string }[] {
  if (channel.type === "email") {
    const issues = [];
    if (blank(channel.profileId))
      issues.push({ field: "channel.profileId", message: "SMTP-Profil fehlt." });
    if (!channel.to.length) issues.push({ field: "channel.to", message: "Empfänger fehlt." });
    const invalid = [...channel.to, ...channel.cc].filter(
      (entry) => !entry.includes("${") && !EMAIL.test(entry),
    );
    if (invalid.length)
      issues.push({ field: "channel.to", message: `Ungültige Adresse: ${invalid[0]}` });
    return issues;
  }
  if (channel.type === "webhook" && blank(channel.webhookId)) {
    return [{ field: "channel.webhookId", message: "Webhook fehlt." }];
  }
  return [];
}

function checkAction(push: Push, action: Action, task: Task) {
  switch (action.type) {
    case "sql":
      if (!action.connections.filter((entry) => !blank(entry)).length)
        push("connections", "Verbindung fehlt.");
      if (blank(action.sql) && blank(action.file)) push("sql", "SQL fehlt.");
      break;
    case "export":
      requireText(push, "connection", action.connection, "Verbindung");
      if (action.source.type === "query") requireText(push, "source.sql", action.source.sql, "SQL");
      else requireText(push, "source.table", action.source.table, "Tabelle");
      checkOutput(push, action.output);
      if (action.output.ifExists === "append" && !APPEND_FORMATS.has(action.format))
        push("output.ifExists", "Anhängen geht nur bei CSV, TSV, JSONL, Markdown und SQL.");
      if (action.format === "xlsx" && (action.sheetName?.length ?? 0) > 31)
        push("sheetName", "Blattnamen dürfen höchstens 31 Zeichen haben.");
      break;
    case "backup":
      requireText(push, "connection", action.connection, "Verbindung");
      checkOutput(push, action.output);
      break;
    case "restore":
      requireText(push, "connection", action.connection, "Verbindung");
      requireText(push, "path", action.path, "Backup-Datei");
      break;
    case "transfer":
      requireText(push, "source", action.source, "Verbindung");
      requireText(push, "target", action.target, "Verbindung");
      if (!action.schemas.length) push("schemas", "Mindestens ein Schema fehlt.");
      else if (action.schemas.some((pair) => blank(pair.source) || blank(pair.target)))
        push("schemas", "Jedes Schema braucht Quelle und Ziel.");
      break;
    case "table_copy":
      requireText(push, "source", action.source, "Verbindung");
      requireText(push, "target", action.target, "Verbindung");
      if (!action.tables.length) push("tables", "Mindestens eine Tabelle fehlt.");
      else if (action.tables.some((item) => blank(item.table) || blank(item.targetTable)))
        push("tables", "Jede Tabelle braucht Quelle und Ziel.");
      break;
    case "datagen":
      requireText(push, "connection", action.connection, "Verbindung");
      requireText(push, "table", action.table, "Tabelle");
      if (!(action.rows >= 1)) push("rows", "Mindestens eine Zeile.");
      break;
    case "import":
      requireText(push, "connection", action.connection, "Verbindung");
      requireText(push, "table", action.table, "Tabelle");
      requireText(push, "file", action.file, "Datei");
      break;
    case "compare":
      requireText(push, "left.connection", action.left.connection, "Verbindung");
      requireText(push, "right.connection", action.right.connection, "Verbindung");
      requireText(push, "left.table", action.left.table, "Tabelle links");
      requireText(push, "right.table", action.right.table, "Tabelle rechts");
      if (!action.keyColumns.length) push("keyColumns", "Schlüsselspalten fehlen.");
      if (action.report) checkOutput(push, action.report, "report");
      break;
    case "check": {
      requireText(push, "connection", action.connection, "Verbindung");
      const check = action.check;
      if (check.type === "row_count" && blank(check.table) && blank(check.sql))
        push("check.table", "Tabelle oder SQL fehlt.");
      if (check.type === "value" || check.type === "query")
        requireText(push, "check.sql", check.sql, "SQL");
      if ("table" in check && check.type !== "row_count")
        requireText(push, "check.table", check.table, "Tabelle");
      if ("column" in check) requireText(push, "check.column", check.column, "Spalte");
      if (check.type === "unique" && !check.columns.filter(Boolean).length)
        push("check.columns", "Spalten fehlen.");
      if (check.type === "accepted_values" && !check.values.length)
        push("check.values", "Erlaubte Werte fehlen.");
      if (check.type === "freshness" && !(check.errorAfterMinutes > 0))
        push("check.errorAfterMinutes", "Grenze für Fehler fehlt.");
      break;
    }
    case "alert":
      requireText(push, "connection", action.connection, "Verbindung");
      requireText(push, "sql", action.sql, "SQL");
      if (action.condition.type === "value")
        requireText(push, "condition.threshold", action.condition.threshold, "Schwellwert");
      break;
    case "shell":
      requireText(push, "program", action.program, "Programm");
      if (!action.successCodes.length) push("successCodes", "Mindestens ein Erfolgscode.");
      break;
    case "http":
      requireText(push, "url", action.url, "URL");
      if (action.expectStatus && !/^\d{3}(-\d{3})?(,\s*\d{3}(-\d{3})?)*$/.test(action.expectStatus))
        push("expectStatus", "Erwarteter Status wie 200, 200-299 oder 200,204.");
      break;
    case "file_copy":
    case "file_move":
      requireText(push, "from", action.from, "Quelle");
      requireText(push, "to", action.to, "Ziel");
      break;
    case "file_delete":
    case "mkdir":
    case "file_exists":
      requireText(push, "path", action.path, "Pfad");
      break;
    case "zip":
      if (!action.sources.filter((entry) => !blank(entry)).length)
        push("sources", "Mindestens eine Quelle fehlt.");
      checkOutput(push, action.output);
      break;
    case "unzip":
      requireText(push, "archive", action.archive, "Archiv");
      requireText(push, "target", action.target, "Zielordner");
      break;
    case "cleanup":
      requireText(push, "dir", action.dir, "Ordner");
      requireText(push, "pattern", action.pattern, "Muster");
      if (action.cleanup.olderThanDays === null && action.cleanup.keepLast === null)
        push("cleanup", "Alter oder Anzahl fehlt.");
      break;
    case "notify":
      for (const issue of channelIssues(action.channel)) push(issue.field, issue.message);
      break;
    case "wait":
      if (action.until) {
        const error = timeError(action.until);
        if (error) push("until", error);
      } else if (!(action.seconds && action.seconds > 0)) {
        push("seconds", "Dauer fehlt.");
      } else if (action.seconds > 86_400) {
        push("seconds", "Höchstens 24 Stunden.");
      }
      break;
    case "set_variable":
      if (!VARIABLE_NAME.test(action.name)) push("name", "Gültiger Variablenname fehlt.");
      if (action.query) {
        requireText(push, "query.connection", action.query.connection, "Verbindung");
        requireText(push, "query.sql", action.query.sql, "SQL");
      }
      break;
    case "condition":
      requireText(push, "left", action.left, "Linker Wert");
      break;
    case "loop": {
      const over = action.over;
      if (over.type === "query") {
        requireText(push, "over.connection", over.connection, "Verbindung");
        requireText(push, "over.sql", over.sql, "SQL");
      }
      if (over.type === "connections" && !over.connections.length && blank(over.tag))
        push("over.connections", "Verbindungen oder Tag fehlen.");
      if (over.type === "list") requireText(push, "over.values", over.values, "Werte");
      if (over.type === "files") requireText(push, "over.dir", over.dir, "Ordner");
      if (!VARIABLE_NAME.test(action.item)) push("item", "Gültiger Name für das Element fehlt.");
      if (!action.steps.length) push("steps", "Die Schleife enthält keine Schritte.", "warning");
      break;
    }
    case "run_task":
      requireText(push, "task", action.task, "Task");
      if (action.task && (action.task === task.id || action.task === task.name))
        push("task", "Ein Task kann sich nicht selbst starten.");
      break;
    case "log":
      requireText(push, "message", action.message, "Text");
      break;
    case "fail":
      requireText(push, "message", action.message, "Meldung");
      break;
  }
}

function checkFlow(push: Push, field: string, flow: Flow, siblings: Step[]) {
  if (flow.type !== "goto") return;
  if (blank(flow.stepId)) push(field, "Sprungziel fehlt.");
  else if (!siblings.some((step) => step.id === flow.stepId))
    push(field, "Sprungziel liegt nicht auf derselben Ebene.");
}

function actionTexts(action: Action): { field: string; text: string; sql: boolean }[] {
  const out: { field: string; text: string; sql: boolean }[] = [];
  const visit = (value: unknown, field: string, sql: boolean) => {
    if (typeof value === "string") out.push({ field, text: value, sql });
    else if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) visit(item, `${field}.${index}`, sql);
    } else if (value && typeof value === "object" && field !== "steps") {
      for (const [key, inner] of Object.entries(value))
        if (key !== "steps") visit(inner, field ? `${field}.${key}` : key, sql || key === "sql");
    }
  };
  visit(action, "", false);
  return out;
}

function stepIssues(
  task: Task,
  steps: Step[],
  known: Set<string>,
  items: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const step of steps) {
    const push: Push = (field, message, severity = "error") =>
      issues.push({ stepId: step.id, field, message, severity });
    if (blank(step.name)) push("name", "Name fehlt.", "warning");
    checkAction(push, step.action, task);
    checkFlow(push, "onSuccess", step.onSuccess, steps);
    checkFlow(push, "onFailure", step.onFailure, steps);
    if (step.action.type === "condition") {
      checkFlow(push, "then", step.action.then, steps);
      checkFlow(push, "otherwise", step.action.otherwise, steps);
    }
    if (step.retry && (step.retry.attempts < 0 || step.retry.attempts > 20))
      push("retry.attempts", "Wiederholungen zwischen 0 und 20.");
    if (step.timeoutSeconds !== null && !(step.timeoutSeconds > 0))
      push("timeoutSeconds", "Timeout muss größer als 0 sein.");
    const scope = step.action.type === "loop" ? [...items, step.action.item] : items;
    for (const { field, text, sql } of actionTexts(step.action)) {
      for (const placeholder of findPlaceholders(text)) {
        const root = placeholder.name.split(/[.:|]/)[0];
        if (placeholder.fallback !== null || isBuiltinPlaceholder(placeholder.name)) continue;
        if ([placeholder.name, root].some((name) => known.has(name) || scope.includes(name)))
          continue;
        push(field, `Unbekannte Variable „${placeholder.name}“.`, "warning");
      }
      if (sql) {
        const unsafe = unsafeSqlPlaceholders(text, scope);
        if (unsafe.length)
          push(field, "Wert wird ungeprüft eingesetzt. Nutze |sql in String-Literalen.", "warning");
      }
    }
    if (step.action.type === "loop")
      issues.push(...stepIssues(task, step.action.steps, known, scope));
  }
  return issues;
}

export function scheduleIssues(schedule: Schedule, task: Task): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (field: string, message: string, severity: Severity = "error") =>
    issues.push({ stepId: null, field: `schedules.${schedule.id}.${field}`, message, severity });
  const trigger = schedule.trigger;
  if ("times" in trigger) {
    if (!trigger.times.length) push("times", "Mindestens eine Uhrzeit fehlt.");
    for (const time of trigger.times) {
      const error = timeError(time);
      if (error) push("times", error);
    }
  }
  if (trigger.type === "interval" && !(trigger.every >= 1)) push("every", "Intervall ab 1.");
  if (trigger.type === "weekly" && !trigger.weekdays.length) push("weekdays", "Wochentag fehlt.");
  if (trigger.type === "monthly" && !trigger.days.length && !trigger.lastDay)
    push("days", "Tag fehlt.");
  if (trigger.type === "monthly" && trigger.days.some((day) => day < 1 || day > 31))
    push("days", "Tage zwischen 1 und 31.");
  if (trigger.type === "cron" && blank(trigger.expression))
    push("expression", "Cron-Ausdruck fehlt.");
  if (trigger.type === "cron" && trigger.expression.trim()) {
    const fields = trigger.expression.trim().split(/\s+/).length;
    if (fields !== 5 && fields !== 6) push("expression", "Cron braucht 5 oder 6 Felder.");
  }
  if (trigger.type === "once" && !LOCAL_DATETIME_PATTERN.test(trigger.at))
    push("at", "Zeitpunkt fehlt.");
  if (trigger.type === "after_task") {
    if (blank(trigger.taskId)) push("taskId", "Task fehlt.");
    else if (trigger.taskId === task.id)
      push("taskId", "Ein Task kann nicht auf sich selbst folgen.");
  }
  if (schedule.window) {
    for (const value of [schedule.window.from, schedule.window.to]) {
      const error = timeError(value);
      if (error) push("window", error);
    }
  }
  if (schedule.timezone && !validTimeZone(schedule.timezone))
    push("timezone", `Unbekannte Zeitzone „${schedule.timezone}“.`);
  if (schedule.startAt && schedule.endAt && schedule.startAt > schedule.endAt)
    push("endAt", "Ende liegt vor dem Start.");
  for (const date of schedule.exclusions)
    if (!DATE_PATTERN.test(date)) push("exclusions", `„${date}“ ist kein Datum.`);
  if (schedule.environment && !task.environments.some((env) => env.name === schedule.environment))
    push("environment", `Umgebung „${schedule.environment}“ gibt es nicht.`);
  return issues;
}

export function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function validateTask(task: Task): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (field: string, message: string, severity: Severity = "error") =>
    issues.push({ stepId: null, field, message, severity });
  if (blank(task.name)) push("name", "Name fehlt.");
  if (!task.steps.length) push("steps", "Der Task hat noch keine Schritte.", "warning");
  const names = new Set<string>();
  task.variables.forEach((variable, index) => {
    const field = `variables.${index}`;
    if (!VARIABLE_NAME.test(variable.name)) push(`${field}.name`, "Ungültiger Variablenname.");
    else if (names.has(variable.name)) push(`${field}.name`, `„${variable.name}“ gibt es doppelt.`);
    else if (isBuiltinPlaceholder(variable.name))
      push(`${field}.name`, `„${variable.name}“ ist eine eingebaute Variable.`);
    names.add(variable.name);
    if (variable.kind === "choice" && !variable.choices.length)
      push(`${field}.choices`, "Auswahl braucht mindestens einen Wert.");
    if (
      variable.kind === "number" &&
      variable.defaultValue &&
      Number.isNaN(Number(variable.defaultValue))
    )
      push(`${field}.defaultValue`, "Standardwert ist keine Zahl.");
    if (
      variable.kind === "date" &&
      variable.defaultValue &&
      !variable.defaultValue.includes("${") &&
      !DATE_PATTERN.test(variable.defaultValue)
    )
      push(`${field}.defaultValue`, "Standardwert ist kein Datum (JJJJ-MM-TT).");
  });
  const envs = new Set<string>();
  task.environments.forEach((env, index) => {
    if (blank(env.name)) push(`environments.${index}.name`, "Name der Umgebung fehlt.");
    else if (envs.has(env.name))
      push(`environments.${index}.name`, `„${env.name}“ gibt es doppelt.`);
    envs.add(env.name);
  });
  if (task.defaultEnvironment && !envs.has(task.defaultEnvironment))
    push("defaultEnvironment", "Standard-Umgebung gibt es nicht.");
  if (task.timeoutSeconds !== null && !(task.timeoutSeconds > 0))
    push("timeoutSeconds", "Timeout muss größer als 0 sein.");
  if (task.maxConsecutiveFailures !== null && !(task.maxConsecutiveFailures >= 1))
    push("maxConsecutiveFailures", "Mindestens 1.");
  for (const schedule of task.schedules) issues.push(...scheduleIssues(schedule, task));
  for (const rule of task.notifications) {
    for (const issue of channelIssues(rule.channel))
      push(`notifications.${rule.id}.${issue.field}`, issue.message, "warning");
  }
  issues.push(...stepIssues(task, task.steps, names, []));
  return issues;
}

export function issuesFor(
  issues: ValidationIssue[],
  stepId: string | null,
  prefix = "",
): ValidationIssue[] {
  return issues.filter(
    (issue) =>
      issue.stepId === stepId &&
      (!prefix || issue.field === prefix || issue.field.startsWith(`${prefix}.`)),
  );
}

export function fieldIssue(
  issues: ValidationIssue[],
  stepId: string | null,
  field: string,
): string | null {
  return issues.find((issue) => issue.stepId === stepId && issue.field === field)?.message ?? null;
}
