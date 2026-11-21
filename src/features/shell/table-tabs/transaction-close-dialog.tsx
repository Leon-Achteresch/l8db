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
  const held = pending ? transactions.filter((tx) => pending.txIds.includes(tx.txId)) : [];
  const changes = held.reduce((sum, tx) => sum + tx.changes.length, 0);
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Offene Transaktion</AlertDialogTitle>
          <AlertDialogDescription>
            {[...new Set(held.map((tx) => tx.connectionName))].join(", ")} · {changes} Änderungen
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
            Rollback
          </Button>
          <Button data-tx-commit onClick={() => void finish(true)}>
            <CheckIcon className="size-3.5" />
            Commit
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
