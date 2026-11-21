import { CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { copyWithToast } from "@/lib/clipboard";
import { previewStagedTable, stagedSqlText, useStagedEdits } from "@/lib/staged-edits";

interface StagedSqlDialogProps {
  stagedKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StagedSqlDialog({ stagedKey, open, onOpenChange }: StagedSqlDialogProps) {
  const entry = useStagedEdits((state) => state.tables[stagedKey]);
  const [result, setResult] = useState<{ text: string; count: number } | { error: string } | null>(
    null,
  );
  useEffect(() => {
    if (!open || !entry) return;
    let cancelled = false;
    setResult(null);
    previewStagedTable(stagedKey)
      .then((statements) => {
        if (!cancelled)
          setResult({ text: stagedSqlText(entry, statements), count: statements.length });
      })
      .catch((error) => {
        if (!cancelled) setResult({ error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, entry, stagedKey]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>SQL der Änderungen</DialogTitle>
          <DialogDescription>
            {entry ? `${entry.schema}.${entry.table}` : ""}
            {result && "count" in result ? ` · ${result.count} Anweisungen` : ""}
          </DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="grid h-32 place-items-center">
            <Spinner />
          </div>
        ) : "error" in result ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : (
          <div className="relative">
            <pre
              data-staged-sql
              className="max-h-[60vh] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all"
            >
              {result.text}
            </pre>
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1 right-1"
              onClick={() => void copyWithToast(result.text, "SQL")}
            >
              <CopyIcon className="size-3.5" />
              Kopieren
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
