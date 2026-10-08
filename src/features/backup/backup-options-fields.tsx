import { LayersIcon, TableIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { BackupMode } from "@/lib/backup";
import type { BackupContent, BackupOptions, DatabaseKind } from "@/lib/db";
import { useSchemasQuery, useTablesQuery } from "@/lib/queries";
import { BackupField } from "./backup-field";
import { BackupFilterRow } from "./backup-filter-row";
import { BackupSegments } from "./backup-segments";

interface BackupOptionsFieldsProps {
  kind: DatabaseKind;
  mode: BackupMode;
  options: BackupOptions;
  disabled?: boolean;
  onChange: (patch: Partial<BackupOptions>) => void;
}

const CONTENT_OPTIONS: { value: BackupContent; label: string }[] = [
  { value: "all", label: "Schema und Daten" },
  { value: "schema", label: "Nur Schema" },
  { value: "data", label: "Nur Daten" },
];

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
  const schemas = useSchemasQuery();
  const tables = useTablesQuery();
  const tableNames = (tables.data ?? []).map((table) =>
    pg ? `${table.schema}.${table.name}` : table.name,
  );
  const showContent = (pg && options.format !== "globals") || (kind === "mysql" && backup);
  const showJobs = pg && (backup ? options.format === "directory" : !options.singleTransaction);

  if (pg && options.format === "globals") return null;

  return (
    <>
      {showContent && (
        <BackupField label="Umfang">
          <BackupSegments
            label="Umfang"
            value={options.content}
            options={CONTENT_OPTIONS}
            disabled={disabled}
            onChange={(content) => onChange({ content })}
          />
        </BackupField>
      )}
      {backup && pg && (
        <BackupFilterRow
          id={`${id}-schemas`}
          label="Schemas"
          include={options.includeSchemas}
          exclude={options.excludeSchemas}
          placeholder="Schema hinzufügen"
          suggestions={schemas.data ?? []}
          icon={LayersIcon}
          disabled={disabled}
          onChange={(includeSchemas, excludeSchemas) =>
            onChange({ includeSchemas, excludeSchemas })
          }
        />
      )}
      {backup && (pg || kind === "mysql") && (
        <BackupFilterRow
          id={`${id}-tables`}
          label="Tabellen"
          include={options.includeTables}
          exclude={options.excludeTables}
          placeholder={pg ? "public.orders" : "orders"}
          suggestions={tableNames}
          icon={TableIcon}
          disabled={disabled}
          onChange={(includeTables, excludeTables) => onChange({ includeTables, excludeTables })}
        />
      )}
      {backup && kind === "mongodb" && (
        <BackupFilterRow
          id={`${id}-collections`}
          label="Collections"
          include={options.includeTables}
          exclude={options.excludeTables}
          includeLabel="Nur eine"
          placeholder="orders"
          suggestions={tableNames}
          icon={TableIcon}
          except={false}
          disabled={disabled}
          onChange={(includeTables, excludeTables) =>
            onChange({ includeTables: includeTables.slice(-1), excludeTables })
          }
        />
      )}
      {showJobs && (
        <BackupField label="Parallele Jobs" htmlFor={`${id}-jobs`}>
          <Input
            id={`${id}-jobs`}
            type="number"
            min={1}
            max={64}
            value={options.jobs ?? 1}
            disabled={disabled}
            className="h-8 w-20 text-right text-xs md:text-xs tabular-nums"
            onChange={(event) =>
              onChange({ jobs: Math.max(1, Math.min(64, Number(event.target.value) || 1)) })
            }
          />
        </BackupField>
      )}
      {!backup && kind === "mongodb" && (
        <BackupField label="Quell-Datenbank" htmlFor={`${id}-source`}>
          <Input
            id={`${id}-source`}
            value={options.sourceDatabase ?? ""}
            disabled={disabled}
            placeholder="Gleich wie Ziel"
            className="h-8 max-w-xs font-mono text-xs md:text-xs"
            onChange={(event) => onChange({ sourceDatabase: event.target.value || null })}
          />
        </BackupField>
      )}
    </>
  );
}
