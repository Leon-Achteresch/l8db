import { CameraIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

import { MigrationScriptPanel } from "@/features/compare/migration-script-panel";
import { useSchemaSnapshot } from "@/features/compare/schema-snapshot-view/use-schema-snapshot";

export function SchemaSnapshotView() {
  const {
    connection,
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
    enabled,
  } = useSchemaSnapshot();

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

      {migrationEnabled && diff !== null && diff.length > 0 && loaded && currentSnapshot && (
        <MigrationScriptPanel
          kind={connection.kind}
          base={loaded}
          current={currentSnapshot}
          entries={diff}
        />
      )}
    </div>
  );
}
