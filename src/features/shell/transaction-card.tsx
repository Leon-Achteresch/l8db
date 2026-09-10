import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SPRING_LAYOUT } from "@/lib/ease";
import { finishManagedTransaction } from "@/lib/managed-transactions";
import { type ActiveTransaction, useTransactionStore } from "@/lib/transactions";
import { DiffQueryEntry } from "./transaction-query-entry";
import { DiffRowEntry } from "./transaction-row-entry";
import { DiffUpdateEntry } from "./transaction-update-entry";

export function TransactionCard({ tx }: { tx: ActiveTransaction }) {
  const busy = useTransactionStore(
    (s) => Boolean(s.busyTransactions[tx.txId]) || s.finalizingTransactions.includes(tx.txId),
  );
  const title =
    tx.scope?.type === "table"
      ? [tx.scope.schema, tx.scope.table].filter(Boolean).join(".")
      : tx.scope?.type === "query"
        ? "SQL-Transaktion"
        : "Gemeinsame Transaktion";
  const queryClient = useQueryClient();

  const handleCommit = useCallback(async () => {
    try {
      await finishManagedTransaction(tx.txId, true);
      void queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] === "rows" || query.queryKey[0] === "count") &&
          query.queryKey[1] === tx.connectionId &&
          (query.queryKey[2] ?? null) === (tx.database ?? null),
      });
      toast.success("Transaktion committed.");
    } catch (err) {
      toast.error(String(err));
    }
  }, [tx, queryClient]);

  const handleRollback = useCallback(async () => {
    try {
      await finishManagedTransaction(tx.txId, false);
      void queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] === "rows" || query.queryKey[0] === "count") &&
          query.queryKey[1] === tx.connectionId &&
          (query.queryKey[2] ?? null) === (tx.database ?? null),
      });
      toast.success("Transaktion zurückgerollt.");
    } catch (err) {
      toast.error(String(err));
    }
  }, [tx, queryClient]);

  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="rounded-lg border border-border bg-card shadow-xs"
    >
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="size-2 rounded-full bg-amber-500 animate-pulse" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground truncate">{title}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {[tx.connectionName, tx.database].filter(Boolean).join(" · ")}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {new Date(tx.startedAt).toLocaleTimeString("de-DE")} · {tx.changes.length}{" "}
            {tx.changes.length === 1 ? "Änderung" : "Änderungen"}
          </p>
        </div>
      </div>

      {tx.scope?.type === "table" && (
        <p className="px-3 pt-2 text-[10px] text-muted-foreground">
          Eigene Transaktion für diese Tabelle. Trigger und Kaskaden gehören ebenfalls dazu.
        </p>
      )}
      <div className="space-y-2 p-2.5">
        {tx.changes.map((change) =>
          change.type === "update" ? (
            <DiffUpdateEntry key={change.id} change={change} />
          ) : change.type === "insert" || change.type === "delete" ? (
            <DiffRowEntry key={change.id} change={change} />
          ) : (
            <DiffQueryEntry key={change.id} change={change} />
          ),
        )}
        {tx.changes.length === 0 && (
          <p className="py-3 text-center text-xs text-muted-foreground">Noch keine Änderungen</p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5 px-3 text-xs"
          disabled={busy}
          aria-label={`${title} committen`}
          onClick={() => void handleCommit()}
        >
          <CheckIcon className="size-3" />
          {tx.scope?.type === "table" ? "Tabelle committen" : "Alles committen"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-xs text-destructive hover:text-destructive"
          disabled={busy}
          aria-label={`${title} zurückrollen`}
          onClick={() => void handleRollback()}
        >
          <RotateCcwIcon className="size-3" />
          Rollback
        </Button>
      </div>
    </motion.div>
  );
}
