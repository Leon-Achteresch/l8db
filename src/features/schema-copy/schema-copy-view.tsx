import { CopyIcon, DatabaseIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DefinitionDiffEditor } from "@/features/compare/definition-diff-editor";
import { useActiveConnection } from "@/lib/connections";
import type { SchemaCopyObjectType } from "@/lib/db";
import {
  MAX_DATA_ROWS,
  OBJECT_TYPES,
  statusLabel,
  statusVariant,
} from "./schema-copy-view/constants";
import { useSchemaCopy } from "./schema-copy-view/use-schema-copy";

export function SchemaCopyView() {
  const connection = useActiveConnection();
  const {
    conflicts,
    dataRetry,
    database,
    ddl,
    entries,
    focused,
    focusedEntry,
    handleDataRetry,
    handleExecute,
    limitValid,
    loadEntries,
    loadError,
    loading,
    log,
    objectType,
    rowLimit,
    running,
    schemas,
    selected,
    setFocused,
    setObjectType,
    setRowLimit,
    setSourceSchema,
    setTargetSchema,
    setTransferData,
    sourceSchema,
    targetSchema,
    toggle,
    transferData,
  } = useSchemaCopy(connection);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <DatabaseIcon className="size-4" />
          <span className="font-medium text-foreground">{connection.name}</span>
          <span>·</span>
          <span>{database ?? "—"}</span>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Quellschema</Label>
          <Select value={sourceSchema} onValueChange={setSourceSchema}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Quelle wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {schemas.map((schema) => (
                <SelectItem key={schema} value={schema} className="text-xs">
                  {schema}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Zielschema</Label>
          <Select value={targetSchema} onValueChange={setTargetSchema}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Ziel wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {schemas.map((schema) => (
                <SelectItem key={schema} value={schema} className="text-xs">
                  {schema}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Objekttyp</Label>
          <Select
            value={objectType}
            onValueChange={(value) => setObjectType(value as SchemaCopyObjectType)}
          >
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OBJECT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value} className="text-xs">
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-8 text-xs"
          onClick={() => void loadEntries()}
          disabled={loading}
        >
          <RefreshCwIcon className="size-3" />
          Neu laden
        </Button>
      </div>

      {sourceSchema && sourceSchema === targetSchema && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs text-destructive">
          <TriangleAlertIcon className="size-3" />
          Quell- und Zielschema sind identisch.
        </div>
      )}
      {loadError && (
        <div className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{loadError}</div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,320px)_1fr] overflow-hidden">
        <div className="flex min-h-0 flex-col overflow-hidden border-r">
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col p-2">
              {entries.length === 0 && !loading && (
                <p className="p-2 text-xs text-muted-foreground">Keine Objekte gefunden.</p>
              )}
              {entries.map((entry) => (
                <div
                  key={entry.name}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                    focused === entry.name ? "bg-accent" : ""
                  }`}
                >
                  <Checkbox
                    checked={selected.includes(entry.name)}
                    onCheckedChange={() => toggle(entry.name)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-mono"
                    onClick={() => setFocused(entry.name)}
                  >
                    {entry.name}
                  </button>
                  <Badge variant={statusVariant(entry.status)} className="text-[10px]">
                    {statusLabel(entry.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="shrink-0 space-y-2 border-t p-2">
            {objectType === "table" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="schema-copy-data"
                    checked={transferData}
                    onCheckedChange={setTransferData}
                  />
                  <Label htmlFor="schema-copy-data" className="text-xs">
                    Daten übernehmen
                  </Label>
                </div>
                {transferData && (
                  <div className="space-y-1">
                    <Label className="text-xs">Zeilenbegrenzung</Label>
                    <Input
                      value={rowLimit}
                      onChange={(event) => setRowLimit(event.target.value)}
                      className="h-7 font-mono text-xs"
                      inputMode="numeric"
                    />
                    {!limitValid && (
                      <span className="text-[10px] text-destructive">
                        Wert zwischen 1 und {MAX_DATA_ROWS}.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {conflicts.length > 0 && (
              <p className="text-[10px] text-destructive">
                Namenskonflikt: {conflicts.join(", ")} existiert bereits in {targetSchema}.
              </p>
            )}
            {objectType === "table" && dataRetry.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full text-xs"
                onClick={() => void handleDataRetry()}
                disabled={running}
              >
                {`Daten erneut übernehmen (${dataRetry.length})`}
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => void handleExecute()}
              disabled={running || selected.length === 0 || conflicts.length > 0}
            >
              <CopyIcon className="size-3" />
              {`In ${targetSchema || "Ziel"} erstellen (${selected.length})`}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b px-3 py-2 text-xs">
            <span className="font-medium">
              {focusedEntry
                ? `${sourceSchema}.${focusedEntry.name} → ${targetSchema}.${focusedEntry.name}`
                : "Kein Objekt gewählt"}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <DefinitionDiffEditor
              original={focusedEntry?.target_definition ?? ""}
              modified={focusedEntry?.source_definition ?? ""}
              onlyDifferences={false}
            />
          </div>
          <div className="shrink-0 border-t">
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
              DDL-Vorschau (wird exakt so ausgeführt)
            </div>
            <ScrollArea className="h-40 border-t">
              <pre className="p-3 font-mono text-[11px] whitespace-pre-wrap">{ddl}</pre>
            </ScrollArea>
          </div>
          {log.length > 0 && (
            <div className="max-h-32 shrink-0 overflow-auto border-t p-3 text-[11px]">
              {log.map((line) => (
                <div key={line} className="font-mono">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
