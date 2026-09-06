import { useQueryClient } from "@tanstack/react-query";

import {
  CheckIcon,
  ChevronRightIcon,
  PlusIcon,
  RotateCcwIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { commitTransaction, rollbackTransaction } from "@/lib/db";
import {
  type ActiveTransaction,
  type TransactionChange,
  useTransactionStore,
} from "@/lib/transactions";
import { cn } from "@/lib/utils";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DiffUpdateEntry({ change }: { change: TransactionChange }) {
  const oldVals = change.oldValues ?? {};
  const newVals = change.newValues ?? {};
  const allKeys = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)])).filter(
    (k) => k !== "__ctid__",
  );

  return (
    <div className="rounded border border-border/60 bg-background overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2.5 py-1.5">
        <ChevronRightIcon className="size-3 text-muted-foreground" />
        <span className="font-mono text-[11px] font-semibold text-foreground/80">
          {change.schema}.{change.table}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          ctid {change.ctid}
        </span>
      </div>
      <div className="font-mono text-[11px] leading-[1.7]">
        {allKeys.map((key) => {
          const raw = oldVals[key];
          const oldStr =
            raw === null || raw === undefined
              ? "NULL"
              : typeof raw === "object"
                ? JSON.stringify(raw)
                : String(raw);
          const newVal = newVals[key];
          const newStr = newVal === null || newVal === undefined ? "NULL" : String(newVal);
          return (
            <div key={key}>
              <div className="flex bg-red-500/[0.07] text-red-600 dark:text-red-400 px-2.5">
                <span className="w-4 shrink-0 select-none text-red-500/60">-</span>
                <span className="text-red-500/70">{key}: </span>
                <span className="ml-1 truncate">{oldStr}</span>
              </div>
              <div className="flex bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400 px-2.5">
                <span className="w-4 shrink-0 select-none text-emerald-500/60">+</span>
                <span className="text-emerald-500/70">{key}: </span>
                <span className="ml-1 truncate">{newStr}</span>
              </div>
            </div>
          );
        })}
        {allKeys.length === 0 && (
          <div className="px-2.5 py-1 text-muted-foreground">Keine sichtbaren Unterschiede</div>
        )}
      </div>
    </div>
  );
}

function formatValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "NULL";
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

function DiffRowEntry({ change }: { change: TransactionChange }) {
  const isInsert = change.type === "insert";
  const values = isInsert ? (change.rowValues ?? {}) : (change.oldValues ?? {});
  const keys = Object.keys(values).filter((k) => k !== "__ctid__");

  return (
    <div className="rounded border border-border/60 bg-background overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2.5 py-1.5">
        {isInsert ? (
          <PlusIcon className="size-3 text-emerald-500" />
        ) : (
          <Trash2Icon className="size-3 text-red-500" />
        )}
        <span className="font-mono text-[11px] font-semibold text-foreground/80">
          {change.schema}.{change.table}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {isInsert ? "INSERT" : "DELETE"}
          {change.ctid ? ` · ctid ${change.ctid}` : ""}
        </span>
      </div>
      <div className="font-mono text-[11px] leading-[1.7]">
        {keys.map((key) => (
          <div
            key={key}
            className={cn(
              "flex px-2.5",
              isInsert
                ? "bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/[0.07] text-red-600 dark:text-red-400",
            )}
          >
            <span
              className={cn(
                "w-4 shrink-0 select-none",
                isInsert ? "text-emerald-500/60" : "text-red-500/60",
              )}
            >
              {isInsert ? "+" : "-"}
            </span>
            <span className={isInsert ? "text-emerald-500/70" : "text-red-500/70"}>{key}: </span>
            <span className="ml-1 truncate">{formatValue(values[key])}</span>
          </div>
        ))}
        {keys.length === 0 && (
          <div className="px-2.5 py-1 text-muted-foreground">
            {isInsert ? "Standardwerte" : "Keine Werte"}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffQueryEntry({ change }: { change: TransactionChange }) {
  return (
    <div className="rounded border border-border/60 bg-background overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/40 px-2.5 py-1.5">
        <TerminalIcon className="size-3 text-muted-foreground" />
        <span className="font-mono text-[11px] font-semibold text-foreground/80">SQL Query</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {formatTime(change.timestamp)}
        </span>
      </div>
      <div className="font-mono text-[11px] leading-[1.7]">
        <div className="bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5">
          <span className="mr-1 select-none text-emerald-500/60">+</span>
          <span className="break-all">{change.sql}</span>
        </div>
        {change.rowsAffected != null && (
          <div className="px-2.5 py-0.5 text-muted-foreground">
            <span className="mr-1 select-none opacity-0">+</span>
            {change.rowsAffected} Zeile(n) betroffen
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionCard({ tx }: { tx: ActiveTransaction }) {
  const removeTransaction = useTransactionStore((s) => s.removeTransaction);
  const queryClient = useQueryClient();

  const handleCommit = useCallback(async () => {
    try {
      await commitTransaction(tx.txId);
      removeTransaction(tx.txId);
      void queryClient.invalidateQueries({ queryKey: ["rows"] });
      void queryClient.invalidateQueries({ queryKey: ["count"] });
      toast.success("Transaktion committed.");
    } catch (err) {
      toast.error(String(err));
    }
  }, [tx.txId, removeTransaction, queryClient]);

  const handleRollback = useCallback(async () => {
    try {
      await rollbackTransaction(tx.txId);
      removeTransaction(tx.txId);
      void queryClient.invalidateQueries({ queryKey: ["rows"] });
      void queryClient.invalidateQueries({ queryKey: ["count"] });
      toast.success("Transaktion zurückgerollt.");
    } catch (err) {
      toast.error(String(err));
    }
  }, [tx.txId, removeTransaction, queryClient]);

  return (
    <div className="rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="size-2 rounded-full bg-amber-500 animate-pulse" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground truncate">{tx.connectionName}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatTime(tx.startedAt)} · {tx.changes.length}{" "}
            {tx.changes.length === 1 ? "Änderung" : "Änderungen"}
          </p>
        </div>
      </div>

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
          onClick={() => void handleCommit()}
        >
          <CheckIcon className="size-3" />
          Commit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-xs text-destructive hover:text-destructive"
          onClick={() => void handleRollback()}
        >
          <RotateCcwIcon className="size-3" />
          Rollback
        </Button>
      </div>
    </div>
  );
}

export function TransactionPanel() {
  const transactions = useTransactionStore((s) => s.transactions);
  const setPanelOpen = useTransactionStore((s) => s.setPanelOpen);

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-card/50">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-xs font-semibold text-foreground">Transactions</span>
        {transactions.length > 0 && (
          <span className="inline-flex size-4 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-600 dark:text-amber-400">
            {transactions.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => setPanelOpen(false)}
          className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {transactions.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="rounded-full border border-border/60 bg-muted/30 p-3">
                <CheckIcon className="size-5 text-muted-foreground/50" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Keine offenen Transaktionen
              </p>
              <p className="max-w-[220px] text-[10px] leading-relaxed text-muted-foreground/70">
                Schreiboperationen (UPDATE, INSERT, DELETE) werden automatisch in einer Transaktion
                ausgeführt.
              </p>
            </div>
          )}
          {transactions.map((tx) => (
            <TransactionCard key={tx.txId} tx={tx} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
