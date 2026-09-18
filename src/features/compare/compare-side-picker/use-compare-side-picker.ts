import { useEffect, useState } from "react";

import { compareLoadErrorMessage, listCompareObjects } from "@/lib/compare-definition";
import { type CompareSideSelection, supportedCompareObjectTypes } from "@/lib/compare-types";
import { type SavedConnection, useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export function useCompareSidePicker(
  value: CompareSideSelection,
  onChange: (value: CompareSideSelection) => void,
  lockConnection: SavedConnection | null | undefined,
) {
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

  return {
    databases,
    schemas,
    objects,
    loadError,
    loadingSchemas,
    loadingObjects,
    usable,
    connection,
    capabilities,
    availableTypes,
    usesOid,
    emit,
    handleConnection,
  };
}
