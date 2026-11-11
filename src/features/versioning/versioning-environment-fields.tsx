import { useQuery } from "@tanstack/react-query";
import { DatabaseIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionsStore } from "@/lib/connections";
import { listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";
import type { VersioningProject } from "@/lib/versioning/types";

export interface EnvironmentValue {
  connectionId: string;
  database: string;
  schema: string;
}

const FIELD = "h-9 w-full min-w-0 rounded-lg text-xs";

export function VersioningEnvironmentFields({
  label,
  tone,
  project,
  value,
  onChange,
}: {
  label: string;
  tone: "test" | "production";
  project: VersioningProject;
  value: EnvironmentValue;
  onChange: (value: EnvironmentValue) => void;
}) {
  const connections = useConnectionsStore((state) => state.connections);
  const connection = connections.find((entry) => entry.id === value.connectionId);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const wantsSchema = useRef(false);
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
  const schemaOptions = schemas.data ?? [];
  const pickSchema = Boolean(connection) && !schemas.error && schemaOptions.length > 0;
  useEffect(() => {
    if (wantsSchema.current && pickSchema) {
      wantsSchema.current = false;
      setSchemaOpen(true);
    }
  }, [pickSchema]);
  const options = connections.filter((entry) => entry.kind === project.kind);
  return (
    <fieldset className="min-w-0 space-y-2.5 rounded-xl bg-background/70 p-3.5">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center gap-2 text-xs font-semibold" aria-hidden="true">
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "production" ? "bg-emerald-500" : "bg-sky-500",
          )}
        />
        {label}
        {value.connectionId && value.schema.trim() && (
          <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
            {value.schema}
          </span>
        )}
      </div>
      <Select
        value={value.connectionId ? `c:${value.connectionId}` : ""}
        onValueChange={(next) => {
          const connectionId = next.slice(2);
          const picked = connections.find((entry) => entry.id === connectionId);
          wantsSchema.current = true;
          onChange({
            connectionId,
            database: picked ? (databaseFromConnectionString(picked.connectionString) ?? "") : "",
            schema: "",
          });
        }}
      >
        <SelectTrigger aria-label={`${label}: Verbindung`} className={FIELD}>
          <SelectValue placeholder={options.length ? "Verbindung" : "Keine passende Verbindung"} />
        </SelectTrigger>
        <SelectContent searchable className="rounded-xl shadow-2xl shadow-black/20">
          {options.map((entry) => (
            <SelectItem key={entry.id} value={`c:${entry.id}`} className="text-xs">
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {connection && (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
          <div className="relative">
            <DatabaseIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={`${label}: Datenbank`}
              placeholder="Datenbank"
              value={value.database}
              onChange={(event) => onChange({ ...value, database: event.target.value, schema: "" })}
              className={cn(FIELD, "pl-7")}
            />
          </div>
          {pickSchema ? (
            <Select
              open={schemaOpen}
              onOpenChange={setSchemaOpen}
              value={value.schema ? `s:${value.schema}` : ""}
              onValueChange={(next) => onChange({ ...value, schema: next.slice(2) })}
            >
              <SelectTrigger aria-label={`${label}: Schema`} className={FIELD}>
                <SelectValue placeholder="Kundenschema" />
              </SelectTrigger>
              <SelectContent searchable className="rounded-xl shadow-2xl shadow-black/20">
                {schemaOptions.map((item) => (
                  <SelectItem key={item} value={`s:${item}`} className="font-mono text-xs">
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="relative">
              <Input
                aria-label={`${label}: Schema`}
                placeholder="Kundenschema"
                value={value.schema}
                onChange={(event) => onChange({ ...value, schema: event.target.value })}
                className={FIELD}
              />
              {schemas.isLoading && (
                <Loader2Icon className="absolute top-1/2 right-2.5 size-3 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
        </div>
      )}
      {schemas.error && (
        <p role="alert" className="text-[11px] text-destructive">
          {String(schemas.error)}
        </p>
      )}
    </fieldset>
  );
}
