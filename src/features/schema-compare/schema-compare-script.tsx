import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  ChevronUpIcon,
  CopyIcon,
  FileCodeIcon,
  FileDownIcon,
  PlayIcon,
  SquareArrowOutUpRightIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SqlEditorPane } from "@/features/extensions/extension-view/sql-editor-pane";
import { copyText } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import type { SyncScript } from "@/lib/schema-compare/script";
import type { CompareResult } from "@/lib/schema-compare/types";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";
import { SchemaCompareRunDialog } from "./schema-compare-run-dialog";

interface SchemaCompareScriptProps {
  result: CompareResult;
  script: SyncScript;
  text: string;
  plan: { create: number; alter: number; drop: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

export function SchemaCompareScript({
  result,
  script,
  text,
  plan,
  open,
  onOpenChange,
}: SchemaCompareScriptProps) {
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
    plan.create > 0 && `${plan.create} erstellen`,
    plan.alter > 0 && `${plan.alter} anpassen`,
    plan.drop > 0 && `${plan.drop} löschen`,
  ].filter(Boolean);

  return (
    <section aria-label="Synchronisationsskript" className="flex shrink-0 flex-col border-t">
      <div className="flex h-11 shrink-0 items-center gap-2 px-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs font-medium"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <FileCodeIcon className="size-3.5" />
          Synchronisationsskript
          <ChevronUpIcon
            className={cn(
              "size-3 text-muted-foreground transition-transform",
              !open && "rotate-180",
            )}
          />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count(script.statements.length, "Anweisung", "Anweisungen")}
        </span>
        {dangerous > 0 && (
          <span
            className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive tabular-nums"
            title="Anweisungen, die Objekte oder Daten im Ziel unwiderruflich entfernen"
          >
            <TriangleAlertIcon className="size-3" />
            {dangerous} kritisch
          </span>
        )}
        {actions.length > 0 && (
          <span
            className="hidden truncate text-xs text-muted-foreground xl:inline"
            title={`Ändert ${result.targetLabel} nach dem Stand von ${result.sourceLabel}`}
          >
            {actions.join(" · ")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={empty}
            onClick={() =>
              void copyText(text).then(
                () => showCopiedMessage("Sync-Skript kopiert"),
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
            variant="outline"
            className="h-7 text-xs"
            disabled={empty}
            onClick={() => setRunning(true)}
          >
            <PlayIcon className="size-3.5" />
            In {result.targetSchema} ausführen…
          </Button>
          <Button
            size="sm"
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
            <SquareArrowOutUpRightIcon className="size-3.5" />
            Im SQL-Editor öffnen
          </Button>
        </div>
      </div>
      {open && (
        <div className="flex h-72 min-h-0 flex-col border-t">
          {script.warnings.length > 0 && (
            <ul className="max-h-24 shrink-0 overflow-auto border-b bg-amber-500/5 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
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
              Keine Objekte ausgewählt.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <SqlEditorPane value={text} readOnly />
            </div>
          )}
        </div>
      )}
      <SchemaCompareRunDialog
        open={running}
        onOpenChange={setRunning}
        result={result}
        statements={script.statements}
      />
    </section>
  );
}
