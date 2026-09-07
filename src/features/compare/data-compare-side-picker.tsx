import { useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DataCompareSidePicker({ title, value, onChange }: DataCompareSidePickerProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);

  const usable = connections.filter((item) => capabilitiesFor(item.kind).data_compare);
  const connection: SavedConnection | null =
    usable.find((item) => item.id === value.connectionId) ?? null;

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

  const handleConnection = (connectionId: string) => {
    const picked = usable.find((item) => item.id === connectionId) ?? null;
    const database = picked
      ? databaseFromConnectionString(effectiveConnectionString(picked))
      : null;
    onChange({ ...EMPTY_DATA_SIDE, connectionId, database });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{title}</span>
        {loadError && <span className="text-xs text-destructive">{loadError}</span>}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Verbindung</Label>
          <Select value={value.connectionId ?? ""} onValueChange={handleConnection}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Verbindung wählen" />
            </SelectTrigger>
            <SelectContent>
              {usable.map((item) => (
                <SelectItem key={item.id} value={item.id} className="text-xs">
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs">Datenbank</Label>
          <Select
            value={value.database ?? ""}
            onValueChange={(database) =>
              onChange({ ...value, database, schema: null, table: null })
            }
            disabled={!connection || databases.length === 0}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Datenbank wählen" />
            </SelectTrigger>
            <SelectContent>
              {databases.map((database) => (
                <SelectItem key={database} value={database} className="text-xs">
                  {database}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs">Schema</Label>
          <Select
            value={value.schema ?? ""}
            onValueChange={(schema) => onChange({ ...value, schema, table: null })}
            disabled={!connection || loadingSchemas || schemas.length === 0}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Schema wählen" />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((schema) => (
                <SelectItem key={schema} value={schema} className="text-xs">
                  {schema}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs">Tabelle</Label>
          <Select
            value={value.table ?? ""}
            onValueChange={(table) => onChange({ ...value, table })}
            disabled={!value.schema || loadingTables || tables.length === 0}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Tabelle wählen" />
            </SelectTrigger>
            <SelectContent>
              {tables.map((name) => (
                <SelectItem key={name} value={name} className="text-xs">
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
