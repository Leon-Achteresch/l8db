import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CopyIcon, FileDownIcon, SquarePenIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { DatabaseKind } from "@/lib/db";
import { buildMigrationScript, migrationFileName } from "@/lib/migration-script";
import type { SchemaSnapshot, SnapshotDiffEntry } from "@/lib/schema-snapshot";
import { useTableTabs } from "@/lib/table-tabs";

const SQL_FILTERS = [{ name: "SQL", extensions: ["sql"] }];

interface MigrationScriptPanelProps {
  kind: DatabaseKind | null;
  base: SchemaSnapshot;
  current: SchemaSnapshot;
  entries: SnapshotDiffEntry[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MigrationScriptPanel({ kind, base, current, entries }: MigrationScriptPanelProps) {
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const [includeDangerous, setIncludeDangerous] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const script = useMemo(
    () => buildMigrationScript({ kind, base, current, entries, includeDangerous }),
    [kind, base, current, entries, includeDangerous],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script.sql);
      toast.success("Migrationsskript kopiert");
    } catch (error) {
      setStatus(`Kopieren fehlgeschlagen: ${errorMessage(error)}`);
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  const handleOpen = () => {
    openQueryTabWithSql(script.sql, `Migration ${base.scope.schema}`);
    toast.success("Skript im Query-Arbeitsplatz geöffnet (nicht ausgeführt)");
  };

  const handleSave = async () => {
    try {
      const path = await save({
        defaultPath: migrationFileName(base.scope.schema, new Date().toISOString()),
        filters: SQL_FILTERS,
      });
      if (!path) {
        setStatus("Speichern abgebrochen.");
        return;
      }
      await writeTextFile(path, script.sql);
      setStatus(`Migrationsskript gespeichert: ${path}`);
      toast.success("Migrationsskript gespeichert");
    } catch (error) {
      setStatus(`Speichern fehlgeschlagen: ${errorMessage(error)}`);
      toast.error("Speichern fehlgeschlagen");
    }
  };

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium">Migrationsskript</span>
        <Badge variant="secondary" className="text-[10px]">
          {script.statements.length} Anweisungen
        </Badge>
        {script.dangerousCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {script.dangerousCount} gefährlich
          </Badge>
        )}
        {script.skippedDangerous > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {script.skippedDangerous} ausgelassen
          </Badge>
        )}
        {script.issues.length > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {script.issues.length} nicht abbildbar
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="migration-dangerous"
            checked={includeDangerous}
            onCheckedChange={setIncludeDangerous}
          />
          <Label htmlFor="migration-dangerous" className="text-xs font-normal">
            Gefährliche Anweisungen einschließen
          </Label>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => void handleCopy()}
          >
            <CopyIcon className="size-3" />
            Kopieren
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => void handleSave()}
          >
            <FileDownIcon className="size-3" />
            Als .sql speichern
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleOpen}>
            <SquarePenIcon className="size-3" />
            In Query-Arbeitsplatz
          </Button>
        </div>
      </div>

      <div className="border-b px-3 py-2 text-xs text-muted-foreground">
        Reihenfolge: neue Tabellen, neue Spalten, Spaltenänderungen, danach Entfernungen.
        {script.transactional
          ? " Das Skript ist in BEGIN/COMMIT geklammert."
          : " Ohne transaktionales DDL: keine BEGIN/COMMIT-Klammer."}{" "}
        Ausgeführt wird nichts automatisch; Ausführung erfolgt bestätigt im Query-Arbeitsplatz.
      </div>

      {script.issues.length > 0 && (
        <div className="border-b px-3 py-2 text-xs text-destructive">
          <span className="font-medium">Nicht abbildbar:</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {script.issues.map((issue) => (
              <li key={`${issue.table}-${issue.column ?? ""}-${issue.detail}`}>
                {issue.table}
                {issue.column ? `.${issue.column}` : ""}: {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ScrollArea className="h-64">
        <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre">{script.sql}</pre>
      </ScrollArea>

      {status && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}
