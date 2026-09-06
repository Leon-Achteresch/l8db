import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { SaveIcon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ExplainNodeCard } from "@/features/query/explain-node-card";
import type { ExplainNode } from "@/lib/db";
import {
  buildSavedExplainPlan,
  defaultExplainFileName,
  EXPLAIN_EXPORT_HINT,
  serializeExplainPlan,
} from "@/lib/explain-file";

const PLAN_FILTERS = [{ name: "l8db-Plan", extensions: ["json"] }];

interface ExplainPlanViewProps {
  plan: ExplainNode;
  analyzed: boolean;
  sql: string;
  connectionName: string;
  databaseKind: string;
  database?: string | null;
  onClose: () => void;
}

export function ExplainPlanView({
  plan,
  analyzed,
  sql,
  connectionName,
  databaseKind,
  database,
  onClose,
}: ExplainPlanViewProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const capturedAt = new Date();
      const path = await save({
        defaultPath: defaultExplainFileName({ connectionName, analyzed, capturedAt }),
        filters: PLAN_FILTERS,
      });
      if (!path) return;
      const saved = buildSavedExplainPlan(plan, {
        sql,
        connectionName,
        databaseKind,
        database,
        analyzed,
        capturedAt,
      });
      await writeTextFile(path, serializeExplainPlan(saved));
      toast.success("Ausführungsplan gespeichert.");
    } catch (error) {
      toast.error(
        `Plan konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }, [plan, sql, connectionName, databaseKind, database, analyzed]);

  return (
    <div className="flex min-h-0 w-full flex-col border-b bg-muted/20">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <span className="text-xs font-medium">
          Ausführungsplan{analyzed ? " (ANALYZE – Query wurde ausgeführt)" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1.5 px-2 text-xs"
          onClick={() => setConfirmOpen(true)}
          disabled={saving}
          title="Plan mit SQL und Kontext als Datei speichern (führt nichts aus)"
        >
          <SaveIcon className="size-3.5" />
          Plan speichern
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
          title="Plan schließen"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="max-h-64 min-h-0 overflow-y-auto px-3 pb-2">
        <ExplainNodeCard node={plan} depth={0} />
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ausführungsplan speichern?</AlertDialogTitle>
            <AlertDialogDescription>{EXPLAIN_EXPORT_HINT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSave()} disabled={saving}>
              Speichern
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
