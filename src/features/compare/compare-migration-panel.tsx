import { CopyIcon, SquareArrowOutUpRightIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SqlEditorPane } from "@/features/extensions/extension-view/sql-editor-pane";
import { copyText } from "@/lib/clipboard";
import { buildCompareApplyPlan } from "@/lib/compare-apply-plan";
import type { CompareSideSelection } from "@/lib/compare-types";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";

type Side = "left" | "right";

interface CompareMigrationPanelProps {
  left: CompareSideSelection;
  right: CompareSideSelection;
  leftDefinition: string;
  rightDefinition: string;
  draft: string | null;
  onClose: () => void;
}

const LABEL: Record<Side, string> = { left: "Für Quelle", right: "Für Ziel" };

export function CompareMigrationPanel({
  left,
  right,
  leftDefinition,
  rightDefinition,
  draft,
  onClose,
}: CompareMigrationPanelProps) {
  const [side, setSide] = useState<Side>("right");
  const connections = useConnectionsStore((state) => state.connections);
  const active = useActiveConnection();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const plans = useMemo(() => {
    const plan = (selection: CompareSideSelection, baseline: string, target: string) => {
      const connection = connections.find((item) => item.id === selection.connectionId) ?? null;
      if (!connection) return { connection, statements: [], error: "Keine Verbindung gewählt." };
      if (baseline === target)
        return { connection, statements: [], error: "Keine Änderungen für diese Seite." };
      try {
        const statements = buildCompareApplyPlan(connection.kind, selection, baseline, target);
        const text = statements
          .map((statement) =>
            connection.kind === "oracle"
              ? `${statement}\n/`
              : /;\s*$/.test(statement)
                ? statement
                : `${statement};`,
          )
          .join("\n");
        return { connection, statements, text, error: null };
      } catch (error) {
        return {
          connection,
          statements: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };
    return {
      right: plan(right, rightDefinition, draft ?? leftDefinition),
      left: plan(left, leftDefinition, draft ?? rightDefinition),
    };
  }, [connections, left, right, leftDefinition, rightDefinition, draft]);
  const current = plans[side];
  const text = current.text ?? "";
  const selection = side === "left" ? left : right;
  const targetActive = Boolean(current.connection) && active?.id === current.connection?.id;

  return (
    <section aria-label="Migration" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {(["right", "left"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={side === item}
            onClick={() => setSide(item)}
            className={cn(
              "relative flex h-9 items-center gap-1.5 px-2.5 text-xs transition-colors",
              side === item
                ? "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LABEL[item]}
            <span className="rounded bg-muted px-1.5 font-mono text-[10px] tabular-nums">
              {plans[item].statements.length}
            </span>
          </button>
        ))}
        {current.connection && (
          <span className="ml-2 truncate text-xs text-muted-foreground">
            für {current.connection.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Migration kopieren"
            title="Kopieren"
            disabled={!text}
            onClick={() =>
              void copyText(text).then(
                () => showCopiedMessage("Migration kopiert"),
                () => toast.error("Kopieren fehlgeschlagen"),
              )
            }
          >
            <CopyIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Im SQL-Editor öffnen"
            title={
              targetActive ? "Im SQL-Editor öffnen" : "Nur möglich, wenn diese Verbindung aktiv ist"
            }
            disabled={!text || !targetActive}
            onClick={() => {
              openQueryTabWithSql(text, `Migration ${selection.objectName ?? ""}`.trim());
              toast.success("Migration im SQL-Editor geöffnet (nicht ausgeführt)");
            }}
          >
            <SquareArrowOutUpRightIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Migration schließen"
            title="Schließen"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>
      {current.error ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          {current.error}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <SqlEditorPane value={text} readOnly />
        </div>
      )}
    </section>
  );
}
