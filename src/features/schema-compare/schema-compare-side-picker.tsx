import { DatabaseIcon, LayersIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { type CompareSide, compareTypesFor } from "@/lib/schema-compare/types";
import { effectiveConnectionString } from "@/lib/ssh";

interface SchemaCompareSidePickerProps {
  title: string;
  value: CompareSide;
  onChange: (value: CompareSide) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SchemaCompareSidePicker({ title, value, onChange }: SchemaCompareSidePickerProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const usable = connections.filter((item) => compareTypesFor(item.kind).length > 0);
  const connection = usable.find((item) => item.id === value.connectionId) ?? null;
  const withDatabases = Boolean(connection && capabilitiesFor(connection.kind).databases);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionId = connection?.id ?? null;

  useEffect(() => {
    setDatabases([]);
    setSchemas([]);
    if (!connectionId) return;
    let active = true;
    setLoading(true);
    setError(null);
    prepareConnection(connectionId)
      .then(async (ready) => {
        const url = effectiveConnectionString(ready);
        const [dbs, list] = await Promise.all([
          capabilitiesFor(ready.kind).databases ? listDatabases(ready.kind, url) : [],
          listSchemas(ready.kind, url, value.database ?? undefined),
        ]);
        if (!active) return;
        setDatabases(dbs);
        setSchemas(visibleSchemas(ready, list));
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId, value.database]);

  const pickConnection = (id: string) => {
    const picked = connections.find((item) => item.id === id);
    onChange({
      connectionId: id,
      database: picked ? databaseFromConnectionString(effectiveConnectionString(picked)) : null,
      schema: null,
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/30 p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Verbindung</Label>
        <Select value={value.connectionId ?? ""} onValueChange={pickConnection}>
          <SelectTrigger className="h-8 w-full min-w-0 text-xs" aria-label={`${title}: Verbindung`}>
            <SelectValue placeholder="Verbindung wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            {usable.map((item) => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
                <ProviderLogo
                  providerId={providerFor(item).id}
                  kind={item.kind}
                  className="size-3.5"
                />
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {withDatabases && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Datenbank</Label>
          <Select
            value={value.database ?? ""}
            onValueChange={(database) => onChange({ ...value, database, schema: null })}
            disabled={databases.length === 0}
          >
            <SelectTrigger
              className="h-8 w-full min-w-0 text-xs"
              aria-label={`${title}: Datenbank`}
            >
              <SelectValue placeholder="Datenbank wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {databases.map((database) => (
                <SelectItem key={database} value={database} className="text-xs">
                  <DatabaseIcon className="size-3.5 text-muted-foreground" />
                  {database}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Schema</Label>
        <Select
          value={value.schema ?? ""}
          onValueChange={(schema) => onChange({ ...value, schema })}
          disabled={!connection || loading || schemas.length === 0}
        >
          <SelectTrigger className="h-8 w-full min-w-0 text-xs" aria-label={`${title}: Schema`}>
            {loading && <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />}
            <SelectValue placeholder={loading ? "Lädt…" : "Schema wählen"} />
          </SelectTrigger>
          <SelectContent searchable>
            {schemas.map((schema) => (
              <SelectItem key={schema} value={schema} className="text-xs">
                <LayersIcon className="size-3.5 text-muted-foreground" />
                {schema}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
