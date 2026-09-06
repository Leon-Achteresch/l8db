import { useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { type FunctionInfo, listDatabases, listFunctions, listSchemas, listViews } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export type CompareObjectType = "view" | "routine";

export interface CompareSideSelection {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  objectType: CompareObjectType;
  objectName: string | null;
  objectOid: string | null;
}

export const EMPTY_SIDE: CompareSideSelection = {
  connectionId: null,
  database: null,
  schema: null,
  objectType: "view",
  objectName: null,
  objectOid: null,
};

interface CompareSidePickerProps {
  title: string;
  value: CompareSideSelection;
  onChange: (value: CompareSideSelection) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function supportedObjectTypes(connection: SavedConnection | null): CompareObjectType[] {
  if (!connection) return [];
  const capabilities = capabilitiesFor(connection.kind);
  const types: CompareObjectType[] = [];
  if (capabilities.views) types.push("view");
  if (capabilities.functions) types.push("routine");
  return types;
}

function routineLabel(routine: FunctionInfo): string {
  return `${routine.name}(${routine.identity_args})`;
}

export function CompareSidePicker({ title, value, onChange }: CompareSidePickerProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [views, setViews] = useState<string[]>([]);
  const [routines, setRoutines] = useState<FunctionInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingObjects, setLoadingObjects] = useState(false);

  const usable = connections.filter((connection) => {
    const capabilities = capabilitiesFor(connection.kind);
    return capabilities.views || capabilities.functions;
  });
  const connection: SavedConnection | null =
    usable.find((item) => item.id === value.connectionId) ?? null;

  useEffect(() => {
    if (!connection) {
      setDatabases([]);
      return;
    }
    let active = true;
    const url = effectiveConnectionString(connection);
    listDatabases(connection.kind, url)
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
    setViews([]);
    setRoutines([]);
    if (!connection) {
      setLoadingSchemas(false);
      return;
    }
    let active = true;
    setLoadingSchemas(true);
    const url = effectiveConnectionString(connection);
    listSchemas(connection.kind, url, value.database ?? undefined)
      .then((list) => {
        if (!active) return;
        setSchemas(list);
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
    setViews([]);
    setRoutines([]);
    if (!connection || !value.schema) {
      setLoadingObjects(false);
      return;
    }
    let active = true;
    setLoadingObjects(true);
    const url = effectiveConnectionString(connection);
    const database = value.database ?? undefined;
    if (value.objectType === "view") {
      listViews(connection.kind, url, database, value.schema)
        .then((list) => {
          if (!active) return;
          setViews(list.map((item) => item.name));
          setLoadError(null);
        })
        .catch((error) => {
          if (!active) return;
          setViews([]);
          setLoadError(`Views: ${errorMessage(error)}`);
        })
        .finally(() => {
          if (active) setLoadingObjects(false);
        });
    } else {
      listFunctions(connection.kind, url, database, value.schema)
        .then((list) => {
          if (!active) return;
          setRoutines(list);
          setLoadError(null);
        })
        .catch((error) => {
          if (!active) return;
          setRoutines([]);
          setLoadError(`Routinen: ${errorMessage(error)}`);
        })
        .finally(() => {
          if (active) setLoadingObjects(false);
        });
    }
    return () => {
      active = false;
    };
  }, [connection, value.database, value.schema, value.objectType]);

  const availableTypes = supportedObjectTypes(connection);

  const handleConnection = (connectionId: string) => {
    const picked = usable.find((item) => item.id === connectionId) ?? null;
    const database = picked ? databaseFromConnectionString(effectiveConnectionString(picked)) : null;
    const types = supportedObjectTypes(picked);
    const objectType = types.includes(value.objectType) ? value.objectType : (types[0] ?? "view");
    onChange({ ...EMPTY_SIDE, objectType, connectionId, database });
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
              onChange({ ...value, database, schema: null, objectName: null, objectOid: null })
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
            onValueChange={(schema) =>
              onChange({ ...value, schema, objectName: null, objectOid: null })
            }
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
          <Label className="text-xs">Objekttyp</Label>
          <Select
            value={value.objectType}
            onValueChange={(objectType) =>
              onChange({
                ...value,
                objectType: objectType as CompareObjectType,
                objectName: null,
                objectOid: null,
              })
            }
            disabled={availableTypes.length < 2}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableTypes.map((type) => (
                <SelectItem key={type} value={type} className="text-xs">
                  {type === "view" ? "View" : "Routine"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Objekt</Label>
        {value.objectType === "view" ? (
          <Select
            value={value.objectName ?? ""}
            onValueChange={(objectName) => onChange({ ...value, objectName, objectOid: null })}
            disabled={!value.schema || loadingObjects || views.length === 0}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="View wählen" />
            </SelectTrigger>
            <SelectContent>
              {views.map((name) => (
                <SelectItem key={name} value={name} className="text-xs">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={value.objectOid ?? ""}
            onValueChange={(oid) => {
              const routine = routines.find((item) => item.oid === oid) ?? null;
              onChange({
                ...value,
                objectOid: oid,
                objectName: routine ? routineLabel(routine) : null,
              });
            }}
            disabled={!value.schema || loadingObjects || routines.length === 0}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Routine wählen" />
            </SelectTrigger>
            <SelectContent>
              {routines.map((routine) => (
                <SelectItem key={routine.oid} value={routine.oid} className="text-xs">
                  {routineLabel(routine)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
