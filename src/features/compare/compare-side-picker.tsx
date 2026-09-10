import {
  DatabaseIcon,
  GitCompareIcon,
  LayersIcon,
  LoaderIcon,
  LockIcon,
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
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { compareLoadErrorMessage, listCompareObjects } from "@/lib/compare-definition";
import {
  COMPARE_OBJECT_LABELS,
  type CompareObjectType,
  type CompareSideSelection,
  supportedCompareObjectTypes,
} from "@/lib/compare-types";
import { providerFor } from "@/lib/connection-url";
import { type SavedConnection, useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

interface CompareSidePickerProps {
  title: string;
  value: CompareSideSelection;
  onChange: (value: CompareSideSelection) => void;
  lockConnection?: SavedConnection | null;
  hideObjectType?: boolean;
}

export function CompareSidePicker({
  title,
  value,
  onChange,
  lockConnection,
  hideObjectType,
}: CompareSidePickerProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [objects, setObjects] = useState<{ name: string; oid: string | null }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingObjects, setLoadingObjects] = useState(false);

  const usable = connections;
  const connection: SavedConnection | null =
    lockConnection ?? usable.find((item) => item.id === value.connectionId) ?? null;
  const capabilities = capabilitiesFor(connection?.kind);
  const availableTypes = supportedCompareObjectTypes(connection);
  const usesOid = value.objectType === "routine" || value.objectType === "procedure";
  const emit = (next: CompareSideSelection) => {
    onChange(lockConnection ? { ...next, connectionId: lockConnection.id } : next);
  };

  useEffect(() => {
    if (!connection || !capabilities.databases) {
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
        setLoadError(`Datenbanken: ${compareLoadErrorMessage(error)}`);
      });
    return () => {
      active = false;
    };
  }, [capabilities.databases, connection]);

  useEffect(() => {
    setSchemas([]);
    setObjects([]);
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
        setLoadError(`Schemas: ${compareLoadErrorMessage(error)}`);
      })
      .finally(() => {
        if (active) setLoadingSchemas(false);
      });
    return () => {
      active = false;
    };
  }, [connection, value.database]);

  useEffect(() => {
    setObjects([]);
    if (!connection || !value.schema) {
      setLoadingObjects(false);
      return;
    }
    let active = true;
    setLoadingObjects(true);
    listCompareObjects(connection, {
      ...value,
      objectName: null,
      objectOid: null,
    })
      .then((list) => {
        if (!active) return;
        setObjects(list);
        setLoadError(null);
      })
      .catch((error) => {
        if (!active) return;
        setObjects([]);
        setLoadError(`Objekte: ${compareLoadErrorMessage(error)}`);
      })
      .finally(() => {
        if (active) setLoadingObjects(false);
      });
    return () => {
      active = false;
    };
  }, [connection, value.database, value.objectType, value.schema]);

  const handleConnection = (connectionId: string) => {
    const picked = usable.find((item) => item.id === connectionId) ?? null;
    const database = picked
      ? databaseFromConnectionString(effectiveConnectionString(picked))
      : null;
    const types = supportedCompareObjectTypes(picked);
    const objectType = types.includes(value.objectType) ? value.objectType : (types[0] ?? "table");
    emit({
      connectionId,
      database,
      schema: null,
      objectType,
      objectName: null,
      objectOid: null,
    });
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

      {capabilities.databases && (
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            <DatabaseIcon className="size-3.5 text-muted-foreground" />
            Datenbank
          </Label>
          <Select
            value={value.database ?? ""}
            onValueChange={(database) =>
              emit({ ...value, database, schema: null, objectName: null, objectOid: null })
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
      )}

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
          onValueChange={(schema) =>
            emit({ ...value, schema, objectName: null, objectOid: null })
          }
          disabled={!connection || loadingSchemas || schemas.length === 0}
        >
          <SelectTrigger className="h-8 w-full min-w-0 text-xs disabled:opacity-100">
            {loadingSchemas && <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />}
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

      {!hideObjectType && (
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-1.5 text-xs">
            <CompareObjectIcon type={value.objectType} />
            Objekttyp
          </Label>
          <Select
            value={value.objectType}
            onValueChange={(objectType) =>
              emit({
                ...value,
                objectType: objectType as CompareObjectType,
                objectName: null,
                objectOid: null,
              })
            }
            disabled={availableTypes.length < 2}
          >
            <SelectTrigger className="h-8 w-full min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableTypes.map((type) => (
                <SelectItem key={type} value={type} className="text-xs">
                  <CompareObjectIcon type={type} />
                  {COMPARE_OBJECT_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label className="flex items-center gap-1.5 text-xs">
          {loadingObjects ? (
            <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <CompareObjectIcon type={value.objectType} />
          )}
          Objekt
        </Label>
        <Select
          value={usesOid ? (value.objectOid ?? "") : (value.objectName ?? "")}
          onValueChange={(picked) => {
            if (usesOid) {
              const match = objects.find((item) => item.oid === picked);
              emit({
                ...value,
                objectOid: picked,
                objectName: match?.name ?? null,
              });
              return;
            }
            emit({ ...value, objectName: picked, objectOid: null });
          }}
          disabled={!value.schema || loadingObjects || objects.length === 0}
        >
          <SelectTrigger className="h-8 w-full min-w-0 text-xs disabled:opacity-100">
            {loadingObjects && <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />}
            <SelectValue placeholder={loadingObjects ? "Lädt…" : "Objekt wählen"} />
          </SelectTrigger>
          <SelectContent>
            {objects.map((item) => (
              <SelectItem
                key={item.oid ?? item.name}
                value={usesOid ? (item.oid ?? item.name) : item.name}
                className="text-xs"
              >
                <CompareObjectIcon type={value.objectType} />
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
