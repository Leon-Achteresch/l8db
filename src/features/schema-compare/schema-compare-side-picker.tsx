import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CameraIcon, DatabaseIcon, LayersIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { capabilitiesFor, supports } from "@/lib/providers";
import { captureCatalogSnapshot, pickSchema, prepareConnection } from "@/lib/schema-compare/store";
import { type CompareSide, compareTypesFor } from "@/lib/schema-compare/types";
import { SNAPSHOT_FILE_FILTERS, serializeSnapshot, snapshotFileName } from "@/lib/schema-snapshot";
import { effectiveConnectionString } from "@/lib/ssh";
import { SchemaCompareSnapshotField } from "./schema-compare-snapshot-field";

interface SchemaCompareSidePickerProps {
  title: string;
  value: CompareSide;
  other: CompareSide;
  onChange: (value: CompareSide) => void;
}

interface Lists {
  key: string;
  databases: string[];
  schemas: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SchemaCompareSidePicker({
  title,
  value,
  other,
  onChange,
}: SchemaCompareSidePickerProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const usable = connections.filter((item) => compareTypesFor(item.kind).length > 0);
  const connection = usable.find((item) => item.id === value.connectionId) ?? null;
  const withDatabases = Boolean(connection && capabilitiesFor(connection.kind).databases);
  const [lists, setLists] = useState<Lists | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState(false);
  const mode = value.snapshot || (pendingFile && !value.connectionId) ? "file" : "live";
  const switchMode = (next: "live" | "file") => {
    setPendingFile(next === "file");
    if (next !== mode) onChange({ connectionId: null, database: null, schema: null });
  };
  const [saving, setSaving] = useState(false);
  const snapshotFeature = useNewFeatureVisibility<HTMLButtonElement>("schema-compare.snapshot");
  const connectionId = connection?.id ?? null;
  const key = connectionId ? `${connectionId}|${value.database ?? ""}` : null;
  const loaded = lists && lists.key === key ? lists : null;
  const databases = loaded?.databases ?? [];
  const schemas = loaded?.schemas ?? [];
  const preferred =
    other.connectionId !== value.connectionId || (other.database ?? "") !== (value.database ?? "")
      ? other.schema
      : null;

  useEffect(() => {
    if (!connectionId || !key) return;
    let active = true;
    setLoading(true);
    setError(null);
    prepareConnection(connectionId)
      .then(async (ready) => {
        const url = effectiveConnectionString(ready);
        const [dbs, list] = await Promise.all([
          capabilitiesFor(ready.kind).databases ? listDatabases(ready.kind, url) : [],
          listSchemas(ready.kind, url, value.database ?? undefined),
        ]);
        if (active) setLists({ key, databases: dbs, schemas: visibleSchemas(ready, list) });
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId, key, value.database]);

  useEffect(() => {
    if (!loaded) return;
    const schema = pickSchema(loaded.schemas, value.schema, preferred);
    if (schema !== value.schema) onChange({ ...value, schema });
  }, [loaded, value, preferred, onChange]);

  const pickConnection = (id: string) => {
    const picked = connections.find((item) => item.id === id);
    onChange({
      connectionId: id,
      database: picked ? databaseFromConnectionString(effectiveConnectionString(picked)) : null,
      schema: null,
    });
  };

  const saveSnapshot = async () => {
    if (!value.schema) return;
    const path = await save({
      defaultPath: snapshotFileName(value.schema, new Date().toISOString()),
      filters: SNAPSHOT_FILE_FILTERS,
    });
    if (!path) return;
    setSaving(true);
    try {
      const snapshot = await captureCatalogSnapshot(value);
      await writeTextFile(path, serializeSnapshot(snapshot));
      toast.success(`Snapshot mit ${snapshot.objects.length} Objekten gespeichert`);
    } catch (cause) {
      toast.error(`Snapshot fehlgeschlagen: ${errorText(cause)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          value={mode}
          onValueChange={(next) => next && switchMode(next as "live" | "file")}
          aria-label={`${title}: Herkunft`}
          className="ml-auto"
        >
          <ToggleGroupItem value="live" className="h-6 px-2 text-xs">
            Verbindung
          </ToggleGroupItem>
          <ToggleGroupItem
            ref={snapshotFeature.ref}
            value="file"
            className="h-6 gap-1 px-2 text-xs"
          >
            Snapshot
            {snapshotFeature.isNew && <NewBadge />}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {mode === "file" ? (
        <SchemaCompareSnapshotField title={title} value={value} onChange={onChange} />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Verbindung</Label>
            <Select value={value.connectionId ?? ""} onValueChange={pickConnection}>
              <SelectTrigger
                className="h-8 w-full min-w-0 text-xs"
                aria-label={`${title}: Verbindung`}
              >
                <SelectValue placeholder="Verbindung wählen" />
              </SelectTrigger>
              <SelectContent searchable>
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
          {withDatabases && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Datenbank</Label>
              <Select
                value={value.database ?? ""}
                onValueChange={(database) => onChange({ ...value, database, schema: null })}
                disabled={databases.length === 0}
              >
                <SelectTrigger
                  className="h-8 w-full min-w-0 text-xs"
                  aria-label={`${title}: Datenbank`}
                >
                  <SelectValue placeholder="Datenbank wählen" />
                </SelectTrigger>
                <SelectContent searchable>
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
            <Label className="text-xs">Schema</Label>
            <Select
              value={value.schema ?? ""}
              onValueChange={(schema) => onChange({ ...value, schema })}
              disabled={!connection || loading || schemas.length === 0}
            >
              <SelectTrigger className="h-8 w-full min-w-0 text-xs" aria-label={`${title}: Schema`}>
                {loading && <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />}
                <SelectValue
                  placeholder={
                    loading
                      ? "Lädt…"
                      : loaded && schemas.length === 0
                        ? "Keine Schemas gefunden"
                        : "Schema wählen"
                  }
                />
              </SelectTrigger>
              <SelectContent searchable>
                {schemas.map((schema) => (
                  <SelectItem key={schema} value={schema} className="text-xs">
                    <LayersIcon className="size-3.5 text-muted-foreground" />
                    {schema}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {connection && value.schema && supports(connection, "schema_snapshot") && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 justify-start gap-1.5 px-2 text-xs"
              disabled={saving}
              onClick={() => void saveSnapshot()}
            >
              {saving ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <CameraIcon className="size-3.5" />
              )}
              Als Snapshot speichern…
            </Button>
          )}
        </>
      )}
    </div>
  );
}
