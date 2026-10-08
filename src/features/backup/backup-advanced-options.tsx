import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { BackupMode } from "@/lib/backup";
import type { BackupOptions, DatabaseKind } from "@/lib/db";
import { BackupOptionSwitch } from "./backup-option-switch";

interface BackupAdvancedOptionsProps {
  kind: DatabaseKind;
  mode: BackupMode;
  options: BackupOptions;
  disabled?: boolean;
  onChange: (patch: Partial<BackupOptions>) => void;
}

interface Toggle {
  key: keyof BackupOptions;
  label: string;
  short: string;
  hint?: string;
}

function togglesFor(kind: DatabaseKind, mode: BackupMode, options: BackupOptions): Toggle[] {
  const backup = mode === "backup";
  const pg = kind === "postgres";
  const list: (Toggle | false)[] = [
    pg &&
      (backup ? options.format === "plain" : true) && {
        key: "clean",
        label: "Objekte vorher löschen (--clean)",
        short: "Vorher löschen",
      },
    pg &&
      options.clean && {
        key: "ifExists",
        label: "Nur vorhandene löschen (--if-exists)",
        short: "Nur vorhandene",
      },
    pg && { key: "noOwner", label: "Eigentümer weglassen (--no-owner)", short: "Ohne Eigentümer" },
    pg && {
      key: "noPrivileges",
      label: "Rechte weglassen (--no-privileges)",
      short: "Ohne Rechte",
    },
    pg &&
      !backup && {
        key: "singleTransaction",
        label: "In einer Transaktion (--single-transaction)",
        short: "Eine Transaktion",
      },
    backup &&
      kind === "mysql" && {
        key: "singleTransaction",
        label: "Konsistenter Snapshot (--single-transaction)",
        short: "Snapshot",
      },
    backup &&
      kind === "mysql" && {
        key: "routines",
        label: "Prozeduren & Funktionen (--routines)",
        short: "Routinen",
      },
    backup &&
      kind === "mysql" && { key: "triggers", label: "Trigger (--triggers)", short: "Trigger" },
    backup && kind === "mysql" && { key: "events", label: "Events (--events)", short: "Events" },
    kind === "mongodb" && { key: "gzip", label: "Gzip-komprimiert (--gzip)", short: "Gzip" },
    !backup &&
      kind === "mongodb" && {
        key: "drop",
        label: "Collections vorher löschen (--drop)",
        short: "Vorher löschen",
      },
    backup &&
      kind === "mssql" && {
        key: "copyOnly",
        label: "Nur Kopie (COPY_ONLY)",
        short: "Nur Kopie",
        hint: "Unterbricht die Sicherungskette nicht.",
      },
    backup &&
      kind === "mssql" && {
        key: "compression",
        label: "Komprimieren (COMPRESSION)",
        short: "Komprimiert",
        hint: "Nicht in Express-Editionen.",
      },
    !backup &&
      kind === "mssql" && {
        key: "replace",
        label: "Vorhandene Datenbank ersetzen (WITH REPLACE)",
        short: "Ersetzen",
      },
    !backup &&
      kind === "mssql" && {
        key: "closeConnections",
        label: "Offene Verbindungen trennen",
        short: "Verbindungen trennen",
        hint: "SINGLE_USER WITH ROLLBACK IMMEDIATE, danach MULTI_USER.",
      },
    !backup &&
      (pg || kind === "mysql" || kind === "mongodb") && {
        key: "exitOnError",
        label: "Beim ersten Fehler abbrechen",
        short: "Abbruch bei Fehler",
        hint: kind === "mysql" ? "Aus: mysql --force setzt nach Fehlern fort." : undefined,
      },
  ];
  return list.filter((entry): entry is Toggle => Boolean(entry));
}

export function BackupAdvancedOptions({
  kind,
  mode,
  options,
  disabled,
  onChange,
}: BackupAdvancedOptionsProps) {
  if (kind === "postgres" && options.format === "globals" && mode === "backup") return null;
  const toggles = togglesFor(kind, mode, options);
  if (toggles.length === 0) return null;
  const active = toggles.filter((toggle) => options[toggle.key]).map((toggle) => toggle.short);

  return (
    <Collapsible className="group/advanced py-4">
      <CollapsibleTrigger className="ml-[calc(9rem+1rem)] flex items-center gap-2 rounded-md text-left text-xs">
        <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]/advanced:rotate-90" />
        <span className="font-semibold">Erweitert</span>
        <span className="truncate text-muted-foreground">
          {active.length ? active.join(", ") : "Standard"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 ml-[calc(9rem+1rem)] grid gap-3 sm:grid-cols-2">
        {toggles.map((toggle) => (
          <BackupOptionSwitch
            key={toggle.key}
            id={`backup-${mode}-${toggle.key}`}
            label={toggle.label}
            hint={toggle.hint}
            checked={Boolean(options[toggle.key])}
            disabled={disabled}
            onChange={(checked) => onChange({ [toggle.key]: checked })}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
