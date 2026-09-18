import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

interface CreateIndexDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  table: string;
  onSuccess: () => void;
}

export function CreateIndexDialog({
  open,
  onOpenChange,
  schema,
  table,
  onSuccess,
}: CreateIndexDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const caps = useActiveCapabilities();
  const [sql, setSql] = useState(() =>
    caps.query_language === "json"
      ? JSON.stringify(
          { createIndexes: table, indexes: [{ key: { field: 1 }, name: "field_1" }] },
          null,
          2,
        )
      : `CREATE INDEX ON "${schema}"."${table}" (column_name);`,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!connection || !sql.trim()) return;
    setRunning(true);
    setError(null);
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
      );
      toast.success("Index erstellt.");
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Neuer Index</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <textarea
            aria-label="Index-Befehl"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            rows={5}
            spellCheck={false}
            className="w-full resize-none rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />
          {error && (
            <pre className="whitespace-pre-wrap break-all rounded-md bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive select-text">
              {error}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleRun} disabled={running || !sql.trim()}>
            {running ? "Ausführen…" : "Ausführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
