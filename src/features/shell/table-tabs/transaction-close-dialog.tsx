import { CheckIcon, RotateCcwIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useStagedEdits } from "@/lib/staged-edits";
import { useTransactionStore } from "@/lib/transactions";
import type { PendingTransactionClose } from "./use-tab-close";

interface TransactionCloseDialogProps {
  pending: PendingTransactionClose;
  setPending: (value: PendingTransactionClose) => void;
  finish: (commit: boolean) => Promise<void>;
}

export function TransactionCloseDialog({
  pending,
  setPending,
  finish,
}: TransactionCloseDialogProps) {
  const transactions = useTransactionStore((state) => state.transactions);
  const tables = useStagedEdits((state) => state.tables);
  const held = pending ? transactions.filter((tx) => pending.txIds.includes(tx.txId)) : [];
  const staged = (pending?.staged ?? []).flatMap((key) => (tables[key] ? [tables[key]] : []));
  const changes =
    held.reduce((sum, tx) => sum + tx.changes.length, 0) +
    staged.reduce((sum, entry) => sum + entry.changes.length, 0);
  const onlyStaged = held.length === 0 && staged.length > 0;
  const names = [
    ...held.map((tx) => tx.connectionName),
    ...staged.map((entry) => `${entry.schema}.${entry.table}`),
  ];
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {onlyStaged ? "Nicht übernommene Änderungen" : "Offene Transaktion"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {[...new Set(names)].join(", ")} · {changes} Änderungen
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => void finish(false)}
          >
            <RotateCcwIcon className="size-3.5" />
            {onlyStaged ? "Verwerfen" : "Rollback"}
          </Button>
          <Button data-tx-commit onClick={() => void finish(true)}>
            <CheckIcon className="size-3.5" />
            {onlyStaged ? "Übernehmen" : "Commit"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
