import { useNavigate } from "@tanstack/react-router";
import { CopyIcon, LoaderIcon, SquarePenIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SqlEditorPane } from "@/features/extensions/extension-view/sql-editor-pane";
import { copyText } from "@/lib/clipboard";
import { buildCompareApplyPlan } from "@/lib/compare-apply-plan";
import type { CompareSideSelection } from "@/lib/compare-types";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { activateConnectionWithToast } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";

type Side = "left" | "right";

interface MigrationPlan {
  connection: SavedConnection | null;
  statements: string[];
  text: string;
  error: string | null;
}

interface CompareMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  left: CompareSideSelection;
  right: CompareSideSelection;
  leftDefinition: string;
  rightDefinition: string;
  draft: string | null;
}

const LABEL: Record<Side, string> = { left: "Für Quelle", right: "Für Ziel" };

function buildPlan(
  connection: SavedConnection | null,
  selection: CompareSideSelection,
  baseline: string,
  target: string,
): MigrationPlan {
  if (!connection)
    return { connection, statements: [], text: "", error: "Keine Verbindung gewählt." };
  if (baseline === target)
    return { connection, statements: [], text: "", error: "Keine Änderungen für diese Seite." };
  try {
    const statements = buildCompareApplyPlan(connection.kind, selection, baseline, target);
    const text =
      connection.kind === "oracle"
        ? statements.join("\n/\n")
        : statements
            .map((statement) => (/;\s*$/.test(statement) ? statement : `${statement};`))
            .join("\n");
    return { connection, statements, text, error: null };
  } catch (error) {
    return {
      connection,
      statements: [],
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function CompareMigrationDialog({
  open,
  onOpenChange,
  left,
  right,
  leftDefinition,
  rightDefinition,
  draft,
}: CompareMigrationDialogProps) {
  const [side, setSide] = useState<Side>("right");
  const [opening, setOpening] = useState(false);
  const connections = useConnectionsStore((state) => state.connections);
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const navigate = useNavigate();
  const plans = useMemo(() => {
    if (!open) return null;
    const find = (selection: CompareSideSelection) =>
      connections.find((item) => item.id === selection.connectionId) ?? null;
    return {
      right: buildPlan(find(right), right, rightDefinition, draft ?? leftDefinition),
      left: buildPlan(find(left), left, leftDefinition, draft ?? rightDefinition),
    };
  }, [open, connections, left, right, leftDefinition, rightDefinition, draft]);
  const lastPlans = useRef(plans);
  if (plans) lastPlans.current = plans;
  const shown = plans ?? lastPlans.current;
  if (!shown) return null;
  const current = shown[side];
  const selection = side === "left" ? left : right;

  const openInEditor = async () => {
    const connection = current.connection;
    if (!connection || !current.text || opening) return;
    setOpening(true);
    try {
      if (
        useConnectionsStore.getState().activeId !== connection.id &&
        !(await activateConnectionWithToast(connection.id))
      )
        return;
      if (selection.database)
        useDbSelectionStore.getState().setDatabase(connection.id, selection.database);
      const id = openQueryTabWithSql(
        current.text,
        `Migration ${selection.objectName ?? ""}`.trim(),
        false,
      );
      onOpenChange(false);
      await navigate({ to: "/query/$id", params: { id } });
      toast.success("Migration im SQL-Editor geöffnet (nicht ausgeführt)");
    } catch (error) {
      toast.error(
        `Migration konnte nicht geöffnet werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !opening && onOpenChange(next)}>
      <DialogContent className="gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Migration erzeugen</DialogTitle>
          <DialogDescription>
            Wähle, welche Seite angepasst werden soll. Das Skript wird im SQL-Editor geöffnet und
            nicht ausgeführt.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["right", "left"] as const).map((item) => {
            const plan = shown[item];
            return (
              <button
                key={item}
                type="button"
                aria-pressed={side === item}
                onClick={() => setSide(item)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  side === item
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted",
                )}
              >
                <span className="flex w-full items-center gap-2 text-sm font-medium">
                  {LABEL[item]}
                  <span className="ml-auto rounded bg-muted px-1.5 font-mono text-[10px] tabular-nums">
                    {plan.statements.length}
                  </span>
                </span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {plan.connection?.name ?? "Keine Verbindung"}
                </span>
              </button>
            );
          })}
        </div>
        {current.error ? (
          <div className="flex h-72 items-center justify-center gap-2 rounded-lg border text-xs text-muted-foreground">
            <TriangleAlertIcon className="size-3.5 shrink-0" />
            {current.error}
          </div>
        ) : (
          <div className="flex h-72 min-h-0 overflow-hidden rounded-lg border">
            <SqlEditorPane key={side} value={current.text} readOnly />
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!current.text}
            onClick={() =>
              void copyText(current.text).then(
                () => showCopiedMessage("Migration kopiert"),
                () => toast.error("Kopieren fehlgeschlagen"),
              )
            }
          >
            <CopyIcon data-icon="inline-start" />
            Kopieren
          </Button>
          <Button disabled={!current.text || opening} onClick={() => void openInEditor()}>
            {opening ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <SquarePenIcon data-icon="inline-start" />
            )}
            Im SQL-Editor öffnen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
