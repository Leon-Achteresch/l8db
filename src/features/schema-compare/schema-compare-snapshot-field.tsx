import { open } from "@tauri-apps/plugin-dialog";
import { FileJsonIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { readCatalogSnapshot, snapshotFileLabel } from "@/lib/schema-compare/store";
import type { CompareSide } from "@/lib/schema-compare/types";
import { SNAPSHOT_FILE_FILTERS } from "@/lib/schema-snapshot";

interface SchemaCompareSnapshotFieldProps {
  title: string;
  value: CompareSide;
  onChange: (value: CompareSide) => void;
}

export function SchemaCompareSnapshotField({
  title,
  value,
  onChange,
}: SchemaCompareSnapshotFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const path = await open({ multiple: false, directory: false, filters: SNAPSHOT_FILE_FILTERS });
    if (typeof path !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = await readCatalogSnapshot(path);
      onChange({
        connectionId: null,
        database: snapshot.database,
        schema: snapshot.schema,
        snapshot: {
          path,
          kind: snapshot.kind,
          createdAt: snapshot.created_at,
          connectionName: snapshot.connection_name,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">Snapshot-Datei</Label>
      <Button
        size="sm"
        variant="outline"
        className="h-8 justify-start gap-1.5 text-xs"
        aria-label={`${title}: Snapshot-Datei wählen`}
        disabled={busy}
        onClick={() => void pick()}
      >
        {busy ? (
          <LoaderIcon className="size-3.5 animate-spin" />
        ) : (
          <FileJsonIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="truncate">
          {value.snapshot ? snapshotFileLabel(value.snapshot.path) : "Datei wählen…"}
        </span>
      </Button>
      {value.snapshot && (
        <p className="text-xs text-muted-foreground">
          {[
            value.snapshot.connectionName,
            value.database,
            value.schema,
            new Date(value.snapshot.createdAt).toLocaleString("de-DE"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
