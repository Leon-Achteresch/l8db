import { useCallback, useEffect, useRef, useState } from "react";

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
  preferredObjectName?: string | null,
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
  const emit = useCallback(
    (next: CompareSideSelection) => {
      onChange(lockConnection ? { ...next, connectionId: lockConnection.id } : next);
    },
    [onChange, lockConnection],
  );
  const loadedSchemas = useRef("");
  const loadedObjects = useRef("");
  const loadedDatabases = useRef<string | null>(null);
  const schemaKey = JSON.stringify([connection?.id, value.database]);
  const objectKey = JSON.stringify([
    connection?.id,
    value.database,
    value.schema,
    value.objectType,
  ]);

  useEffect(() => {
    if (!connection || !capabilities.databases) {
      setDatabases([]);
      return;
    }
    let active = true;
    listDatabases(connection.kind, effectiveConnectionString(connection))
      .then((list) => {
        if (!active) return;
        loadedDatabases.current = connection.id;
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
        loadedSchemas.current = schemaKey;
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
  }, [connection, value.database, schemaKey]);

  useEffect(() => {
    setObjects([]);
    if (!connection || !value.schema) {
      setLoadingObjects(false);
      return;
    }
    let active = true;
    setLoadingObjects(true);
    listCompareObjects(connection, {
      connectionId: connection.id,
      database: value.database,
      schema: value.schema,
      objectType: value.objectType,
      objectName: null,
      objectOid: null,
    })
      .then((list) => {
        if (!active) return;
        loadedObjects.current = objectKey;
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
  }, [connection, value.database, value.objectType, value.schema, objectKey]);

  useEffect(() => {
    if (
      loadedSchemas.current === schemaKey &&
      !loadingSchemas &&
      !value.schema &&
      schemas.length === 1
    ) {
      emit({ ...value, schema: schemas[0], objectName: null, objectOid: null });
    }
  }, [schemas, loadingSchemas, value, emit, schemaKey]);

  useEffect(() => {
    if (
      loadedObjects.current !== objectKey ||
      loadingObjects ||
      value.objectName ||
      !preferredObjectName
    )
      return;
    const matches = objects.filter((item) => item.name === preferredObjectName);
    if (matches.length === 1)
      emit({ ...value, objectName: matches[0].name, objectOid: matches[0].oid });
  }, [objects, loadingObjects, preferredObjectName, value, emit, objectKey]);

  useEffect(() => {
    if (loadedDatabases.current === connection?.id && !value.database && databases.length === 1)
      emit({ ...value, database: databases[0], schema: null, objectName: null, objectOid: null });
  }, [databases, value, emit, connection?.id]);

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
