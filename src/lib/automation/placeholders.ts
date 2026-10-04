export interface PlaceholderInfo {
  name: string;
  description: string;
  example: string;
}

export interface FoundPlaceholder {
  name: string;
  fallback: string | null;
  filter: string | null;
  start: number;
  end: number;
}

export const PLACEHOLDER_FILTERS = [
  { name: "sql", description: "Für SQL-Textliterale escapen" },
  { name: "json", description: "Als JSON-String-Inhalt escapen" },
  { name: "url", description: "Für URLs prozent-kodieren" },
  { name: "filename", description: "Zeichen ersetzen, die in Dateinamen verboten sind" },
  { name: "upper", description: "In Großbuchstaben" },
  { name: "lower", description: "In Kleinbuchstaben" },
  { name: "trim", description: "Leerraum am Rand entfernen" },
] as const;

export const BUILTIN_PLACEHOLDERS: PlaceholderInfo[] = [
  { name: "date", description: "Heutiges Datum", example: "2026-10-04" },
  { name: "time", description: "Uhrzeit, dateinamensicher", example: "07-30-00" },
  { name: "timestamp", description: "Datum und Uhrzeit kompakt", example: "20261004-073000" },
  { name: "date:%Y/%m", description: "Datum mit eigenem Format", example: "2026/10" },
  { name: "date-1d", description: "Gestern (Einheiten s m h d w M y)", example: "2026-10-03" },
  { name: "now", description: "Zeitpunkt in UTC (RFC 3339)", example: "2026-10-04T05:30:00Z" },
  { name: "task", description: "Name des Tasks", example: "Täglicher Bericht" },
  { name: "task_id", description: "ID des Tasks", example: "task-1" },
  { name: "run_id", description: "ID des Laufs", example: "run-8f2c" },
  { name: "trigger", description: "Auslöser des Laufs", example: "schedule" },
  { name: "environment", description: "Gewählte Umgebung", example: "production" },
  { name: "connection", description: "Name der Verbindung des Schritts", example: "Reporting" },
  { name: "connection_id", description: "ID der Verbindung des Schritts", example: "conn-a" },
  { name: "database", description: "Datenbank des Schritts", example: "app" },
  { name: "host", description: "Host der Verbindung", example: "db.intern" },
  { name: "user", description: "Benutzer des Betriebssystems", example: "leon" },
  { name: "hostname", description: "Name des Rechners", example: "macbook" },
  { name: "home", description: "Benutzerordner", example: "/Users/leon" },
  { name: "output_dir", description: "Standard-Ausgabeordner", example: "~/l8db-Ausgaben" },
  { name: "last.rows", description: "Zeilen des letzten Schritts", example: "1234" },
  { name: "last.value", description: "Erster Wert des letzten Schritts", example: "42" },
  { name: "last.error", description: "Fehler des letzten Schritts, sonst leer", example: "" },
  { name: "last.output", description: "Ausgabedatei des letzten Schritts", example: "bericht.csv" },
  { name: "run.status", description: "Status des Laufs (Benachrichtigungen)", example: "success" },
  { name: "run.duration", description: "Dauer des Laufs (Benachrichtigungen)", example: "12 s" },
  { name: "run.error", description: "Fehler des Laufs (Benachrichtigungen)", example: "" },
  { name: "run.outputs", description: "Ausgabedateien, eine pro Zeile", example: "bericht.csv" },
  { name: "run.summary", description: "Schritt-Übersicht als Text", example: "1 SQL ✓ …" },
  { name: "alert.status", description: "Zustand des Alarms", example: "triggered" },
  { name: "alert.value", description: "Messwert des Alarms", example: "17" },
  { name: "alert.since", description: "Seit wann der Zustand gilt", example: "2026-10-04T05:00Z" },
];

const BUILTIN_ROOTS = new Set([
  "date",
  "time",
  "timestamp",
  "now",
  "task",
  "task_id",
  "run_id",
  "trigger",
  "environment",
  "connection",
  "connection_id",
  "database",
  "host",
  "user",
  "hostname",
  "home",
  "output_dir",
  "last",
  "run",
  "step",
  "alert",
]);

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*/;

export function findPlaceholders(text: string): FoundPlaceholder[] {
  const found: FoundPlaceholder[] = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf("${", index);
    if (start < 0) break;
    if (start > 0 && text[start - 1] === "$") {
      index = start + 2;
      continue;
    }
    const close = text.indexOf("}", start + 2);
    if (close < 0) break;
    const inner = text.slice(start + 2, close);
    const pipe = inner.lastIndexOf("|");
    const body = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const filter = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
    const fallbackAt = body.indexOf(":-");
    const name = (fallbackAt >= 0 ? body.slice(0, fallbackAt) : body).trim();
    found.push({
      name,
      fallback: fallbackAt >= 0 ? body.slice(fallbackAt + 2) : null,
      filter: filter || null,
      start,
      end: close + 1,
    });
    index = close + 1;
  }
  return found;
}

export function placeholderRoot(name: string): string {
  const match = NAME.exec(name)?.[0] ?? name;
  const relative = /^date[+-]\d/.exec(match) ? "date" : match;
  return relative.split(/[.:]/)[0];
}

export function isBuiltinPlaceholder(name: string): boolean {
  return BUILTIN_ROOTS.has(placeholderRoot(name)) || /^date[:+-]/.test(name);
}

export function unsafeSqlPlaceholders(sql: string, itemNames: string[] = ["item"]): string[] {
  const roots = new Set(["step", ...itemNames]);
  const unsafe = findPlaceholders(sql)
    .filter((entry) => entry.filter !== "sql" && roots.has(placeholderRoot(entry.name)))
    .map((entry) => entry.name);
  return [...new Set(unsafe)];
}

export function placeholderSuggestions(
  variables: { name: string; description: string; defaultValue: string; kind: string }[],
  environmentKeys: string[],
  items: string[],
  topLevel: { id: string; name: string }[],
): PlaceholderInfo[] {
  const own = variables.map((variable) => ({
    name: variable.name,
    description: variable.description || "Variable des Tasks",
    example: variable.kind === "secret" ? "••••" : variable.defaultValue,
  }));
  const known = new Set(own.map((entry) => entry.name));
  const env = environmentKeys
    .filter((key) => !known.has(key))
    .map((key) => ({ name: key, description: "Wert aus der Umgebung", example: "" }));
  const loop = items.map((item) => ({
    name: item,
    description: "Aktuelles Element der Schleife",
    example: "",
  }));
  const steps = topLevel.flatMap((step, index) => [
    { name: `step.${index + 1}.rows`, description: `Zeilen aus „${step.name}“`, example: "120" },
    {
      name: `step.${index + 1}.value`,
      description: `Erster Wert aus „${step.name}“`,
      example: "42",
    },
    {
      name: `step.${index + 1}.output`,
      description: `Ausgabedatei von „${step.name}“`,
      example: "",
    },
  ]);
  return [...loop, ...own, ...env, ...BUILTIN_PLACEHOLDERS, ...steps];
}
