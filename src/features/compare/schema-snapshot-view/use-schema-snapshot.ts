import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  collectTables,
  errorMessage,
  JSON_FILTERS,
} from "@/features/compare/schema-snapshot-view/collect-tables";
import { useActiveConnection } from "@/lib/connections";
import { listTables } from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import {
  buildSnapshot,
  diffSnapshots,
  parseSnapshot,
  type SchemaSnapshot,
  type SnapshotDiffEntry,
  serializeSnapshot,
  snapshotFileName,
} from "@/lib/schema-snapshot";
import { effectiveConnectionString } from "@/lib/ssh";

export function useSchemaSnapshot() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const enabled = supports(connection, "schema_snapshot");
  const migrationEnabled = supports(connection, "migration_script");

  const [tables, setTables] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<SchemaSnapshot | null>(null);
  const [diff, setDiff] = useState<SnapshotDiffEntry[] | null>(null);
  const [currentSnapshot, setCurrentSnapshot] = useState<SchemaSnapshot | null>(null);
  const requestRef = useRef(0);

  const loadTables = useCallback(async () => {
    setTables([]);
    setSelected([]);
    const request = requestRef.current + 1;
    requestRef.current = request;
    if (!connection || !enabled) return;
    try {
      const list = await listTables(
        connection.kind,
        effectiveConnectionString(connection),
        database ?? undefined,
        schema,
      );
      if (requestRef.current !== request) return;
      const names = list.map((item) => item.name);
      setTables(names);
      setSelected(names);
      setStatus(null);
    } catch (error) {
      if (requestRef.current !== request) return;
      setTables([]);
      setSelected([]);
      setStatus(`Tabellenliste nicht lesbar: ${errorMessage(error)}`);
    }
  }, [connection, database, schema, enabled]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  const toggle = (table: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, table] : current.filter((item) => item !== table),
    );
  };

  const handleSave = async () => {
    if (!connection || selected.length === 0) return;
    setBusy(true);
    setDiff(null);
    setCurrentSnapshot(null);
    try {
      const collected = await collectTables(connection, database, schema, selected);
      const snapshot = buildSnapshot(
        {
          connection_name: connection.name,
          kind: connection.kind,
          database,
          schema,
          requested_tables: selected,
        },
        collected,
      );
      const failed = collected
        .filter((table) => table.incomplete_reason !== null)
        .map((table) => table.name);
      setIncomplete(failed);
      const path = await save({
        defaultPath: snapshotFileName(schema, snapshot.captured_at),
        filters: JSON_FILTERS,
      });
      if (!path) {
        setStatus("Speichern abgebrochen.");
        return;
      }
      await writeTextFile(path, serializeSnapshot(snapshot));
      setStatus(
        snapshot.complete
          ? `Snapshot mit ${collected.length} Tabellen gespeichert.`
          : `Snapshot gespeichert, aber unvollständig (${failed.length} Tabellen ohne Metadaten).`,
      );
      toast.success("Snapshot gespeichert");
    } catch (error) {
      setStatus(`Snapshot fehlgeschlagen: ${errorMessage(error)}`);
      toast.error("Snapshot fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const handleCompare = async () => {
    if (!connection) return;
    const path = await open({ multiple: false, directory: false, filters: JSON_FILTERS });
    if (!path) return;
    setBusy(true);
    try {
      const snapshot = parseSnapshot(await readTextFile(path));
      const collected = await collectTables(
        connection,
        database,
        snapshot.scope.schema,
        snapshot.scope.requested_tables,
      );
      const current = buildSnapshot(
        {
          connection_name: connection.name,
          kind: connection.kind,
          database,
          schema: snapshot.scope.schema,
          requested_tables: snapshot.scope.requested_tables,
        },
        collected,
      );
      const failed = collected
        .filter((table) => table.incomplete_reason !== null)
        .map((table) => table.name);
      setIncomplete(failed);
      setLoaded(snapshot);
      setCurrentSnapshot(current);
      setDiff(diffSnapshots(snapshot, current));
      setStatus(
        `Snapshot vom ${new Date(snapshot.captured_at).toLocaleString()} (${snapshot.scope.connection_name}, ${snapshot.scope.database ?? "—"}, ${snapshot.scope.schema}) verglichen.`,
      );
    } catch (error) {
      setDiff(null);
      setLoaded(null);
      setCurrentSnapshot(null);
      setStatus(`Vergleich fehlgeschlagen: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return {
    connection,
    enabled,
    database,
    schema,
    migrationEnabled,
    tables,
    selected,
    setSelected,
    busy,
    status,
    incomplete,
    loaded,
    diff,
    currentSnapshot,
    loadTables,
    toggle,
    handleSave,
    handleCompare,
  };
}
