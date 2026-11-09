import { useQuery } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/shell/workbench-dialog";
import { copyWithToast } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { type PrincipalChange, previewPrincipalChange } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

interface PrincipalSqlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  change: PrincipalChange;
  applying: boolean;
  onApply: () => void;
}

export function PrincipalSqlDialog({
  open,
  onOpenChange,
  change,
  applying,
  onApply,
}: PrincipalSqlDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const { data, error, isLoading } = useQuery({
    queryKey: ["principal-preview", connection?.id, database, change],
    queryFn: () =>
      previewPrincipalChange(
        connection!.kind,
        effectiveConnectionString(connection!),
        change,
        database ?? undefined,
      ),
    enabled: open && Boolean(connection),
    gcTime: 0,
    staleTime: 0,
  });
  const sql = (data ?? []).map((statement) => `${statement};`).join("\n");

  return (
    <Dialog busy={applying} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>SQL</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <p className="text-[13px] text-destructive select-text">{String(error)}</p>
        ) : (
          <pre className="max-h-[50vh] overflow-auto rounded-2xl bg-muted/40 p-4 font-mono text-xs leading-5 whitespace-pre-wrap select-text">
            {sql}
          </pre>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={!sql} onClick={() => copyWithToast(sql, "SQL")}>
            <CopyIcon data-icon="inline-start" />
            Kopieren
          </Button>
          <Button disabled={!sql || applying} onClick={onApply}>
            {applying && <Spinner />}
            Anwenden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
