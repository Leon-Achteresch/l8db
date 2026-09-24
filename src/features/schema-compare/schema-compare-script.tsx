import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CopyIcon, FileDownIcon, PlayIcon, SquarePenIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SqlEditorPane } from "@/features/extensions/extension-view/sql-editor-pane";
import { copyText } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import type { SyncScript } from "@/lib/schema-compare/script";
import type { CompareResult } from "@/lib/schema-compare/types";
import { useTableTabs } from "@/lib/table-tabs";
import { SchemaCompareRunDialog } from "./schema-compare-run-dialog";

interface SchemaCompareScriptProps {
  result: CompareResult;
  script: SyncScript;
  text: string;
  plan: { create: number; alter: number; drop: number };
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

export function SchemaCompareScript({ result, script, text, plan }: SchemaCompareScriptProps) {
  const target = result.target;
  const active = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const [running, setRunning] = useState(false);
  const empty = script.statements.length === 0;
  const targetActive =
    active?.id === target.connectionId &&
    (!target.database || !activeDatabase || target.database === activeDatabase);
  const dangerous = script.statements.filter((statement) => statement.dangerous).length;

  const saveFile = async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const path = await save({
      defaultPath: `sync-${result.targetSchema}-${stamp}.sql`,
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    if (!path) return;
    await writeTextFile(path, text);
    toast.success("Sync-Skript gespeichert");
  };

  const actions = [
    plan.create > 0 && `${count(plan.create, "Objekt", "Objekte")} erstellen`,
    plan.alter > 0 && `${count(plan.alter, "Objekt", "Objekte")} anpassen`,
    plan.drop > 0 && `${count(plan.drop, "Objekt", "Objekte")} löschen`,
  ].filter(Boolean);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b bg-muted/30 px-3 py-2 text-xs">
        Das Skript ändert <strong>{result.targetLabel}</strong> und übernimmt dafür den Stand aus{" "}
        <strong>{result.sourceLabel}</strong>
        {actions.length > 0 ? `: ${actions.join(", ")}.` : "."}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Badge variant="secondary" className="text-[10px]">
          {script.statements.length} {script.statements.length === 1 ? "Anweisung" : "Anweisungen"}
        </Badge>
        {dangerous > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {dangerous} kritisch
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={empty}
            onClick={() =>
              void copyText(text).then(
                () => toast.success("Sync-Skript kopiert"),
                () => toast.error("Kopieren fehlgeschlagen"),
              )
            }
          >
            <CopyIcon className="size-3.5" />
            Kopieren
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={empty}
            onClick={() =>
              void saveFile().catch((error) =>
                toast.error(`Speichern fehlgeschlagen: ${String(error)}`),
              )
            }
          >
            <FileDownIcon className="size-3.5" />
            Speichern…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={empty || !targetActive}
            title={
              targetActive
                ? "Im SQL-Arbeitsplatz der Zielverbindung öffnen"
                : "Nur möglich, wenn die Zielverbindung aktiv ist"
            }
            onClick={() => {
              openQueryTabWithSql(text, `Sync ${result.targetSchema}`);
              toast.success("Skript im SQL-Arbeitsplatz geöffnet (nicht ausgeführt)");
            }}
          >
            <SquarePenIcon className="size-3.5" />
            Im SQL-Editor öffnen
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={empty}
            onClick={() => setRunning(true)}
          >
            <PlayIcon className="size-3.5" />
            In {result.targetSchema} ausführen…
          </Button>
        </div>
      </div>
      {script.warnings.length > 0 && (
        <ul className="max-h-28 shrink-0 overflow-auto border-b bg-amber-500/5 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          {script.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}
      {empty ? (
        <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
          Keine Objekte ausgewählt. Unterschiede in der Liste anhaken, um ein Skript zu erzeugen.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <SqlEditorPane value={text} readOnly />
        </div>
      )}
      <SchemaCompareRunDialog
        open={running}
        onOpenChange={setRunning}
        result={result}
        statements={script.statements}
      />
    </div>
  );
}
