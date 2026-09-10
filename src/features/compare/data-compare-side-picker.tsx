import {
  DatabaseIcon,
  GitCompareIcon,
  LayersIcon,
  LoaderIcon,
  LockIcon,
  TableIcon,
} from "lucide-react";
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
import { type SavedConnection, useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas, listTables } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export interface DataCompareSideSelection {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  table: string | null;
}

export const EMPTY_DATA_SIDE: DataCompareSideSelection = {
  connectionId: null,
  database: null,
  schema: null,
  table: null,
};

interface DataCompareSidePickerProps {
  title: string;
  value: DataCompareSideSelection;
  onChange: (value: DataCompareSideSelection) => void;
  lockConnection?: SavedConnection | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DataCompareSidePicker({
  title,
  value,
  onChange,
  lockConnection,
}: DataCompareSidePickerProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);

  const usable = connections.filter((item) => capabilitiesFor(item.kind).data_compare);
  const connection: SavedConnection | null =
    lockConnection ?? usable.find((item) => item.id === value.connectionId) ?? null;

  useEffect(() => {
    if (!connection) {
      setDatabases([]);
      return;
    }
    let active = true;
    listDatabases(connection.kind, effectiveConnectionString(connection))
      .then((list) => {
        if (!active) return;
        setDatabases(list);
        setLoadError(null);
      })
      .catch((error) => {
        if (!active) return;
        setDatabases([]);
        setLoadError(`Datenbanken: ${errorMessage(error)}`);
      });
    return () => {
      active = false;
    };
  }, [connection]);

  useEffect(() => {
    setSchemas([]);
    if (!connection) {
      setLoadingSchemas(false);
      return;
    }
    let active = true;
    setLoadingSchemas(true);
    listSchemas(connection.kind, effectiveConnectionString(connection), value.database ?? undefined)
      .then((list) => {
        if (!active) return;
        setSchemas(visibleSchemas(connection, list));
        setLoadError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSchemas([]);
        setLoadError(`Schemas: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setLoadingSchemas(false);
      });
    return () => {
      active = false;
    };
  }, [connection, value.database]);

  useEffect(() => {
    setTables([]);
    if (!connection || !value.schema) {
      setLoadingTables(false);
      return;
    }
    let active = true;
    setLoadingTables(true);
    listTables(
      connection.kind,
      effectiveConnectionString(connection),
      value.database ?? undefined,
      value.schema,
    )
      .then((list) => {
        if (!active) return;
        setTables(list.map((item) => item.name));
        setLoadError(null);
      })
      .catch((error) => {
        if (!active) return;
        setTables([]);
        setLoadError(`Tabellen: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setLoadingTables(false);
      });
    return () => {
      active = false;
    };
  }, [connection, value.database, value.schema]);

  const emit = (next: DataCompareSideSelection) => {
    onChange(lockConnection ? { ...next, connectionId: lockConnection.id } : next);
  };

  const handleConnection = (connectionId: string) => {
    const picked = usable.find((item) => item.id === connectionId) ?? null;
    const database = picked
      ? databaseFromConnectionString(effectiveConnectionString(picked))
      : null;
    emit({ ...EMPTY_DATA_SIDE, connectionId, database });
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        {lockConnection ? (
          <LockIcon className="size-3.5 shrink-0 text-emerald-500" />
        ) : (
          <GitCompareIcon className="size-3.5 shrink-0 text-sky-500" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {lockConnection && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <ProviderLogo
              providerId={providerFor(lockConnection).id}
              kind={lockConnection.kind}
              className="size-3.5"
            />
            <span className="truncate">{lockConnection.name}</span>
          </span>
        )}
      </div>
      {loadError && <span className="text-xs text-destructive">{loadError}</span>}

      <div className="flex flex-col gap-2">
        {!lockConnection && (
          <div className="flex flex-col gap-1">
            <Label className="flex items-center gap-1.5 text-xs">
              <GitCompareIcon className="size-3.5 text-muted-foreground" />
              Verbindung
            </Label>
            <Select value={value.connectionId ?? ""} onValueChange={handleConnection}>
              <SelectTrigger className="h-8 w-full min-w-0 text-xs">
                <SelectValue placeholder="Verbindung wählen" />
              </SelectTrigger>
              <SelectContent>
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
        )}

        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            <DatabaseIcon className="size-3.5 text-muted-foreground" />
            Datenbank
          </Label>
          <Select
            value={value.database ?? ""}
            onValueChange={(database) =>
              emit({ ...value, database, schema: null, table: null })
            }
            disabled={!connection || databases.length === 0}
          >
            <SelectTrigger className="h-8 w-full min-w-0 text-xs">
              <SelectValue placeholder="Datenbank wählen" />
            </SelectTrigger>
            <SelectContent>
              {databases.map((database) => (
                <SelectItem key={database} value={database} className="text-xs">
                  <DatabaseIcon className="size-3.5 text-muted-foreground" />
                  {database}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            {loadingSchemas ? (
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
            ) : (
              <LayersIcon className="size-3.5 text-muted-foreground" />
            )}
            Schema
          </Label>
          <Select
            value={value.schema ?? ""}
            onValueChange={(schema) => emit({ ...value, schema, table: null })}
            disabled={!connection || loadingSchemas || schemas.length === 0}
          >
            <SelectTrigger className="h-8 w-full min-w-0 text-xs disabled:opacity-100">
              {loadingSchemas && (
                <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              )}
              <SelectValue placeholder={loadingSchemas ? "Lädt…" : "Schema wählen"} />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((schema) => (
                <SelectItem key={schema} value={schema} className="text-xs">
                  <LayersIcon className="size-3.5 text-muted-foreground" />
                  {schema}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            {loadingTables ? (
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
            ) : (
              <TableIcon className="size-3.5 text-emerald-500" />
            )}
            Tabelle
          </Label>
          <Select
            value={value.table ?? ""}
            onValueChange={(table) => emit({ ...value, table })}
            disabled={!value.schema || loadingTables || tables.length === 0}
          >
            <SelectTrigger className="h-8 w-full min-w-0 text-xs disabled:opacity-100">
              {loadingTables && (
                <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              )}
              <SelectValue placeholder={loadingTables ? "Lädt…" : "Tabelle wählen"} />
            </SelectTrigger>
            <SelectContent>
              {tables.map((name) => (
                <SelectItem key={name} value={name} className="text-xs">
                  <TableIcon className="size-3.5 text-emerald-500" />
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
