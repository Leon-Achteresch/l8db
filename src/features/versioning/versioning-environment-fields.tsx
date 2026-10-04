import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
import { listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import type { VersioningProject } from "@/lib/versioning/types";
import { VersioningSelect } from "./versioning-select";

export interface EnvironmentValue {
  connectionId: string;
  database: string;
  schema: string;
}

export function VersioningEnvironmentFields({
  label,
  project,
  value,
  onChange,
}: {
  label: string;
  project: VersioningProject;
  value: EnvironmentValue;
  onChange: (value: EnvironmentValue) => void;
}) {
  const id = useId();
  const connections = useConnectionsStore((state) => state.connections);
  const connection = connections.find((entry) => entry.id === value.connectionId);
  const schemas = useQuery({
    queryKey: ["versioning-schemas", connection?.id, connection?.tunnelPort, value.database],
    enabled: Boolean(connection),
    retry: false,
    queryFn: () =>
      connection
        ? listSchemas(
            connection.kind,
            effectiveConnectionString(connection),
            value.database.trim() || undefined,
          )
        : [],
  });
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 text-xs font-semibold">{label}</legend>
      <VersioningSelect
        label={`${label}: Verbindung`}
        value={value.connectionId}
        onChange={(connectionId) => {
          const next = connections.find((entry) => entry.id === connectionId);
          onChange({
            connectionId,
            database: next ? (databaseFromConnectionString(next.connectionString) ?? "") : "",
            schema: "",
          });
        }}
        placeholder="Verbindung auswählen"
        options={connections
          .filter((entry) => entry.kind === project.kind)
          .map((entry) => ({ value: entry.id, label: entry.name }))}
      />
      <Input
        aria-label={`${label}: Datenbank`}
        placeholder="Datenbank der Verbindung"
        value={value.database}
        onChange={(event) => onChange({ ...value, database: event.target.value, schema: "" })}
      />
      <Input
        aria-label={`${label}: Schema`}
        list={`${id}-schemas`}
        placeholder={schemas.isLoading ? "Schemas werden geladen" : "Kundenschema"}
        value={value.schema}
        onChange={(event) => onChange({ ...value, schema: event.target.value })}
      />
      <datalist id={`${id}-schemas`}>
        {(schemas.data ?? []).map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      {schemas.error && (
        <p role="alert" className="text-[11px] text-destructive">
          {String(schemas.error)}
        </p>
      )}
    </fieldset>
  );
}
