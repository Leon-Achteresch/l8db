import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { CameraIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type SavedConnection, useActiveConnection } from "@/lib/connections";
import { listTableColumnsDetailed, listTables } from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import {
  buildSnapshot,
  buildSnapshotTable,
  diffSnapshots,
  parseSnapshot,
  type SchemaSnapshot,
  type SnapshotDiffEntry,
  type SnapshotTable,
  serializeSnapshot,
  snapshotFileName,
} from "@/lib/schema-snapshot";
import { effectiveConnectionString } from "@/lib/ssh";

const JSON_FILTERS = [{ name: "Snapshot", extensions: ["json"] }];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectTables(
  connection: SavedConnection,
  database: string | null,
  schema: string,
  tables: string[],
): Promise<SnapshotTable[]> {
  const url = effectiveConnectionString(connection);
  const collected: SnapshotTable[] = [];
  for (const table of tables) {
    try {
      const columns = await listTableColumnsDetailed(
        connection.kind,
        url,
        schema,
        table,
        database ?? undefined,
      );
      collected.push(buildSnapshotTable(schema, table, columns));
    } catch (error) {
      collected.push(buildSnapshotTable(schema, table, [], errorMessage(error)));
    }
  }
  return collected;
}

export function SchemaSnapshotView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const enabled = supports(connection, "schema_snapshot");

  const [tables, setTables] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<SchemaSnapshot | null>(null);
  const [diff, setDiff] = useState<SnapshotDiffEntry[] | null>(null);
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
      setDiff(diffSnapshots(snapshot, current));
      setStatus(
        `Snapshot vom ${new Date(snapshot.captured_at).toLocaleString()} (${snapshot.scope.connection_name}, ${snapshot.scope.database ?? "—"}, ${snapshot.scope.schema}) verglichen.`,
      );
    } catch (error) {
      setDiff(null);
      setLoaded(null);
      setStatus(`Vergleich fehlgeschlagen: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Metadaten-Snapshots werden für diese Verbindung nicht unterstützt.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {connection.name} · {database ?? "—"} · {schema}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void loadTables()}
          disabled={busy}
        >
          <RefreshCwIcon className="size-3" />
          Tabellen neu laden
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => void handleSave()}
          disabled={busy || selected.length === 0}
        >
          <CameraIcon className="size-3" />
          Snapshot speichern ({selected.length})
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void handleCompare()}
          disabled={busy}
        >
          <FolderOpenIcon className="size-3" />
          Snapshot laden und vergleichen
        </Button>
      </div>

      {status && <p className="text-xs text-muted-foreground">{status}</p>}

      {incomplete.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Unvollständiger Umfang</AlertTitle>
          <AlertDescription>
            Metadaten fehlen für: {incomplete.join(", ")} (fehlende Berechtigung oder Objekt
            entfernt).
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-md border">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Checkbox
            id="snapshot-all"
            checked={selected.length === tables.length && tables.length > 0}
            onCheckedChange={(checked) => setSelected(checked === true ? tables : [])}
          />
          <Label htmlFor="snapshot-all" className="text-xs">
            Alle Tabellen ({tables.length})
          </Label>
        </div>
        <ScrollArea className="h-48">
          <div className="flex flex-col gap-1 p-3">
            {tables.length === 0 && (
              <span className="text-xs text-muted-foreground">Keine Tabellen im Schema.</span>
            )}
            {tables.map((table) => (
              <div key={table} className="flex items-center gap-2">
                <Checkbox
                  id={`snapshot-${table}`}
                  checked={selected.includes(table)}
                  onCheckedChange={(checked) => toggle(table, checked === true)}
                />
                <Label htmlFor={`snapshot-${table}`} className="text-xs font-normal">
                  {table}
                </Label>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {diff !== null && (
        <div className="rounded-md border">
          <div className="border-b px-3 py-2 text-xs font-medium">
            Unterschiede zum aktuellen Stand
            {loaded ? ` · Snapshot-Version ${loaded.version}` : ""}
          </div>
          {diff.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Keine Unterschiede zum geladenen Snapshot.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {diff.map((entry) => (
                <div
                  key={`${entry.kind}-${entry.table}-${entry.column ?? ""}`}
                  className="grid gap-1 px-3 py-2 text-xs md:grid-cols-4"
                >
                  <span className="font-mono">
                    {entry.table}
                    {entry.column ? `.${entry.column}` : ""}
                  </span>
                  <span>{entry.detail}</span>
                  <span className="text-muted-foreground">{entry.before ?? "—"}</span>
                  <span className="text-muted-foreground">{entry.after ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
