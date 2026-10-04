import type {
  Comparator,
  ExportFormat,
  HttpMethod,
  IfExists,
  ImportFileFormat,
  LogLevel,
  NotifyWhen,
  Trigger,
  VariableKind,
  VarQueryMode,
} from "@/lib/db/automation";

export const COMPARATOR_LABELS: Record<Comparator, string> = {
  eq: "gleich",
  ne: "ungleich",
  gt: "größer als",
  gte: "größer oder gleich",
  lt: "kleiner als",
  lte: "kleiner oder gleich",
  contains: "enthält",
  not_contains: "enthält nicht",
  matches: "passt auf Regex",
  empty: "ist leer",
  not_empty: "ist nicht leer",
};

export const NUMERIC_COMPARATORS: Comparator[] = ["eq", "ne", "gt", "gte", "lt", "lte"];

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  tsv: "TSV",
  json: "JSON",
  jsonl: "JSON Lines",
  xlsx: "Excel (XLSX)",
  xml: "XML",
  html: "HTML",
  parquet: "Parquet",
  markdown: "Markdown",
  sql: "SQL-INSERT",
};

export const IMPORT_FORMAT_LABELS: Record<ImportFileFormat, string> = {
  csv: "CSV",
  json: "JSON",
  ndjson: "NDJSON",
  xlsx: "Excel (XLSX)",
  parquet: "Parquet",
};

export const IF_EXISTS_LABELS: Record<IfExists, string> = {
  rename: "Neue Datei mit Nummer",
  overwrite: "Überschreiben",
  append: "Anhängen",
  fail: "Mit Fehler abbrechen",
};

export const NOTIFY_WHEN_LABELS: Record<NotifyWhen, string> = {
  failure: "Bei Fehler",
  success: "Bei Erfolg",
  warning: "Bei Warnungen",
  always: "Immer",
  alert_triggered: "Wenn ein Alarm auslöst",
  alert_resolved: "Bei Entwarnung",
};

export const TRIGGER_LABELS: Record<Trigger["type"], string> = {
  interval: "Intervall",
  daily: "Täglich",
  weekly: "Wöchentlich",
  monthly: "Monatlich",
  monthly_nth: "Monatlich relativ",
  cron: "Cron",
  once: "Einmalig",
  app_start: "Beim Start",
  after_task: "Nach Task",
};

export const VARIABLE_KIND_LABELS: Record<VariableKind, string> = {
  text: "Text",
  number: "Zahl",
  boolean: "Ja/Nein",
  date: "Datum",
  choice: "Auswahl",
  secret: "Geheim",
};

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "Debug",
  info: "Info",
  warn: "Warnung",
  error: "Fehler",
};

export const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

export const VAR_QUERY_MODE_LABELS: Record<VarQueryMode, string> = {
  first_value: "Erster Wert",
  row_count: "Anzahl Zeilen",
  column_list: "Erste Spalte als Liste",
  json: "Alle Zeilen als JSON",
};
