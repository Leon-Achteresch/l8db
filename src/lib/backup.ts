import type { BackupOptions, DatabaseKind } from "@/lib/db";

export type BackupMode = "backup" | "restore";

export interface BackupFormat {
  value: string;
  label: string;
  extension: string;
  directory?: boolean;
  serverSide?: boolean;
  noFile?: boolean;
}

export const BACKUP_FORMATS: Partial<Record<DatabaseKind, BackupFormat[]>> = {
  postgres: [
    { value: "custom", label: "Custom (pg_restore, komprimiert)", extension: "dump" },
    { value: "plain", label: "SQL-Skript (psql)", extension: "sql" },
    { value: "directory", label: "Verzeichnis (parallel)", extension: "", directory: true },
    { value: "tar", label: "Tar-Archiv", extension: "tar" },
    { value: "globals", label: "Nur Rollen & Tablespaces (pg_dumpall)", extension: "sql" },
  ],
  mysql: [{ value: "sql", label: "SQL-Skript (mysqldump)", extension: "sql" }],
  mongodb: [{ value: "archive", label: "Archiv (mongodump)", extension: "archive" }],
  sqlite: [{ value: "sqlite", label: "SQLite-Datei (Backup-API)", extension: "sqlite" }],
  mssql: [
    { value: "bak", label: "BACKUP DATABASE (Serverpfad)", extension: "bak", serverSide: true },
  ],
  redis: [{ value: "bgsave", label: "BGSAVE auf dem Server", extension: "", noFile: true }],
};

export const EMPTY_BACKUP_OPTIONS: BackupOptions = {
  format: "",
  content: "all",
  includeSchemas: [],
  excludeSchemas: [],
  includeTables: [],
  excludeTables: [],
  clean: false,
  ifExists: false,
  noOwner: false,
  noPrivileges: false,
  jobs: null,
  singleTransaction: false,
  routines: false,
  triggers: false,
  events: false,
  gzip: false,
  copyOnly: false,
  compression: false,
  exitOnError: false,
  drop: false,
  replace: false,
  closeConnections: false,
  sourceDatabase: null,
};

export function defaultBackupOptions(kind: DatabaseKind, mode: BackupMode): BackupOptions {
  const format = BACKUP_FORMATS[kind]?.[0]?.value ?? "";
  const base = { ...EMPTY_BACKUP_OPTIONS, format };
  if (mode === "restore") {
    return {
      ...base,
      exitOnError: true,
      ifExists: true,
      jobs: kind === "postgres" ? 4 : null,
      gzip: kind === "mongodb",
    };
  }
  switch (kind) {
    case "postgres":
      return { ...base, ifExists: true, jobs: 4 };
    case "mysql":
      return { ...base, singleTransaction: true, routines: true, triggers: true };
    case "mongodb":
      return { ...base, gzip: true };
    case "mssql":
      return { ...base, copyOnly: true };
    default:
      return base;
  }
}

export function backupFormat(kind: DatabaseKind, value: string): BackupFormat | undefined {
  const formats = BACKUP_FORMATS[kind] ?? [];
  return formats.find((format) => format.value === value) ?? formats[0];
}

export function backupToolFor(kind: DatabaseKind, format: string): string | null {
  if (kind === "postgres") return format === "globals" ? "pg_dumpall" : "pg_dump";
  if (kind === "mysql") return "mysqldump";
  if (kind === "mongodb") return "mongodump";
  return null;
}

export function restoreToolFor(kind: DatabaseKind): string | null {
  if (kind === "mysql") return "mysql";
  if (kind === "mongodb") return "mongorestore";
  return null;
}

export function supportsRestore(kind: DatabaseKind): boolean {
  return Boolean(BACKUP_FORMATS[kind]) && kind !== "redis";
}

export function parseNameList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "backup"
  );
}

export function defaultBackupFileName(
  kind: DatabaseKind,
  options: Pick<BackupOptions, "format" | "gzip">,
  name: string,
  now: Date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const format = backupFormat(kind, options.format);
  const base = `${slug(name)}-${format?.value === "globals" ? "globals-" : ""}${stamp}`;
  if (!format?.extension) return base;
  const gzip = kind === "mongodb" && options.gzip ? ".gz" : "";
  return `${base}.${format.extension}${gzip}`;
}

export function restoreConfirmationPhrase(
  database: string | null | undefined,
  connectionName: string,
): string {
  return database?.trim() || connectionName;
}

export function restoreBlockReason(
  connection: { kind: DatabaseKind; readOnly?: boolean } | null | undefined,
  capabilities: { backup: boolean },
): string | null {
  if (!connection) return "Keine Verbindung aktiv.";
  if (!capabilities.backup || !supportsRestore(connection.kind))
    return "Wiederherstellung wird für diesen Datenbanktyp nicht unterstützt.";
  if (connection.readOnly)
    return "Lesemodus: Diese Verbindung ist schreibgeschützt. Wiederherstellung ist gesperrt.";
  return null;
}

export function restoreEffects(kind: DatabaseKind, options: BackupOptions): string[] {
  const effects: string[] = [];
  if (kind === "sqlite")
    effects.push("Die Datenbankdatei wird vollständig durch die Sicherung ersetzt.");
  if (kind === "postgres" && options.clean)
    effects.push("Vorhandene Objekte werden vor dem Einspielen gelöscht (--clean).");
  if (kind === "mongodb" && options.drop)
    effects.push("Vorhandene Collections werden vor dem Einspielen gelöscht (--drop).");
  if (kind === "mssql" && options.replace)
    effects.push("Die vorhandene Datenbank wird ersetzt (WITH REPLACE).");
  if (kind === "mssql" && options.closeConnections)
    effects.push("Alle offenen Verbindungen zur Datenbank werden getrennt.");
  if (kind === "mysql" && !options.exitOnError)
    effects.push("Fehlerhafte Anweisungen werden übersprungen (--force).");
  return effects;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function progressPercent(done: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function appendLogLines(existing: string[], lines: string[], limit = 1000): string[] {
  const next = existing.concat(lines);
  return next.length > limit ? next.slice(next.length - limit) : next;
}
