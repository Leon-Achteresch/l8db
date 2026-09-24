import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BackupMode } from "@/lib/backup";
import type { BackupContent, BackupOptions, DatabaseKind } from "@/lib/db";
import { BackupNameListInput } from "./backup-name-list-input";
import { BackupOptionSwitch } from "./backup-option-switch";

interface BackupOptionsFieldsProps {
  kind: DatabaseKind;
  mode: BackupMode;
  options: BackupOptions;
  disabled?: boolean;
  onChange: (patch: Partial<BackupOptions>) => void;
}

export function BackupOptionsFields({
  kind,
  mode,
  options,
  disabled,
  onChange,
}: BackupOptionsFieldsProps) {
  const id = `backup-${mode}`;
  const backup = mode === "backup";
  const pg = kind === "postgres";
  const showContent = (pg && options.format !== "globals") || (kind === "mysql" && backup);
  const showJobs = pg && (backup ? options.format === "directory" : !options.singleTransaction);
  const toggle = (key: keyof BackupOptions, label: string, hint?: string) => (
    <BackupOptionSwitch
      id={`${id}-${key}`}
      label={label}
      hint={hint}
      checked={Boolean(options[key])}
      disabled={disabled}
      onChange={(checked) => onChange({ [key]: checked })}
    />
  );
  const list = (
    key: "includeSchemas" | "excludeSchemas" | "includeTables" | "excludeTables",
    label: string,
    placeholder: string,
  ) => (
    <BackupNameListInput
      id={`${id}-${key}`}
      label={label}
      placeholder={placeholder}
      value={options[key]}
      disabled={disabled}
      onChange={(value) => onChange({ [key]: value })}
    />
  );

  if (pg && options.format === "globals") return null;

  return (
    <div className="grid gap-4">
      {(showContent || showJobs) && (
        <div className="flex flex-wrap items-end gap-4">
          {showContent && (
            <div className="grid gap-1">
              <Label htmlFor={`${id}-content`} className="text-xs">
                Inhalt
              </Label>
              <Select
                value={options.content}
                disabled={disabled}
                onValueChange={(value) => onChange({ content: value as BackupContent })}
              >
                <SelectTrigger id={`${id}-content`} size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Schema und Daten</SelectItem>
                  <SelectItem value="schema">Nur Schema</SelectItem>
                  <SelectItem value="data">Nur Daten</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {showJobs && (
            <div className="grid gap-1">
              <Label htmlFor={`${id}-jobs`} className="text-xs">
                Parallele Jobs
              </Label>
              <Input
                id={`${id}-jobs`}
                type="number"
                min={1}
                max={64}
                value={options.jobs ?? 1}
                disabled={disabled}
                className="h-8 w-24 text-xs"
                onChange={(event) =>
                  onChange({ jobs: Math.max(1, Math.min(64, Number(event.target.value) || 1)) })
                }
              />
            </div>
          )}
        </div>
      )}

      {backup && pg && (
        <div className="grid gap-3 sm:grid-cols-2">
          {list("includeSchemas", "Nur Schemas", "public, sales")}
          {list("excludeSchemas", "Schemas ausschließen", "audit")}
          {list("includeTables", "Nur Tabellen", "public.orders, public.items")}
          {list("excludeTables", "Tabellen ausschließen", "public.logs")}
        </div>
      )}
      {backup && kind === "mysql" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {list("includeTables", "Nur Tabellen", "orders, items")}
          {list("excludeTables", "Tabellen ausschließen", "logs")}
        </div>
      )}
      {backup && kind === "mongodb" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {list("includeTables", "Nur Collection (eine)", "orders")}
          {list("excludeTables", "Collections ausschließen", "logs, sessions")}
        </div>
      )}
      {!backup && kind === "mongodb" && (
        <div className="grid max-w-sm gap-1">
          <Label htmlFor={`${id}-source`} className="text-xs">
            Quell-Datenbank im Archiv (optional)
          </Label>
          <Input
            id={`${id}-source`}
            value={options.sourceDatabase ?? ""}
            disabled={disabled}
            placeholder="gleich wie Ziel"
            className="h-8 font-mono text-xs"
            onChange={(event) => onChange({ sourceDatabase: event.target.value || null })}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {pg &&
          (backup ? options.format === "plain" : true) &&
          toggle("clean", "Objekte vorher löschen (--clean)")}
        {pg && options.clean && toggle("ifExists", "Nur vorhandene löschen (--if-exists)")}
        {pg && toggle("noOwner", "Eigentümer weglassen (--no-owner)")}
        {pg && toggle("noPrivileges", "Rechte weglassen (--no-privileges)")}
        {pg &&
          !backup &&
          toggle("singleTransaction", "In einer Transaktion (--single-transaction)")}
        {backup && kind === "mysql" && (
          <>
            {toggle("singleTransaction", "Konsistenter Snapshot (--single-transaction)")}
            {toggle("routines", "Prozeduren & Funktionen (--routines)")}
            {toggle("triggers", "Trigger (--triggers)")}
            {toggle("events", "Events (--events)")}
          </>
        )}
        {kind === "mongodb" && toggle("gzip", "Gzip-komprimiert (--gzip)")}
        {!backup && kind === "mongodb" && toggle("drop", "Collections vorher löschen (--drop)")}
        {backup && kind === "mssql" && (
          <>
            {toggle("copyOnly", "Nur Kopie (COPY_ONLY)", "Unterbricht die Sicherungskette nicht.")}
            {toggle("compression", "Komprimieren (COMPRESSION)", "Nicht in Express-Editionen.")}
          </>
        )}
        {!backup && kind === "mssql" && (
          <>
            {toggle("replace", "Vorhandene Datenbank ersetzen (WITH REPLACE)")}
            {toggle(
              "closeConnections",
              "Offene Verbindungen trennen",
              "SINGLE_USER WITH ROLLBACK IMMEDIATE, danach MULTI_USER.",
            )}
          </>
        )}
        {!backup &&
          (pg || kind === "mysql" || kind === "mongodb") &&
          toggle(
            "exitOnError",
            "Beim ersten Fehler abbrechen",
            kind === "mysql" ? "Aus: mysql --force setzt nach Fehlern fort." : undefined,
          )}
      </div>
    </div>
  );
}
