import { CheckIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveConnection } from "@/lib/connections";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useCapabilities } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { useTransactionStore } from "@/lib/transactions";
import { TransactionCard } from "./transaction-card";

export function TransactionPanel() {
  const connection = useActiveConnection();
  const capabilities = useCapabilities(connection?.kind);
  const perTable = useSettingsStore((state) => state.transactionsPerTable);
  const transactions = useTransactionStore((s) => s.transactions);
  const setPanelOpen = useTransactionStore((s) => s.setPanelOpen);

  return (
    <div data-tour="tx-panel" className="flex h-full min-h-0">
      <motion.div
        layout
        transition={{ layout: SPRING_LAYOUT }}
        className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-card/50"
      >
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
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {perTable && capabilities.table_transactions
                ? "Tabellen werden getrennt committed. Abhängige Änderungen brauchen den gemeinsamen Modus unter Einstellungen → Daten & Abfragen. SQL im Editor läuft separat."
                : perTable
                  ? "Diese Datenbank verwendet eine gemeinsame Transaktion. Getrennte Tabellen-Transaktionen werden nicht unterstützt."
                  : "Gemeinsamer Modus: Tabellenänderungen und SQL werden pro Datenbank zusammen committed."}
            </p>
            {transactions.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <div className="rounded-full border border-border/60 bg-muted/30 p-3">
                  <CheckIcon className="size-5 text-muted-foreground/50" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  Keine offenen Transaktionen
                </p>
                <p className="max-w-[220px] text-[10px] leading-relaxed text-muted-foreground/70">
                  Schreiboperationen (UPDATE, INSERT, DELETE) werden automatisch in einer
                  Transaktion ausgeführt.
                </p>
              </div>
            )}
            {transactions.map((tx) => (
              <TransactionCard key={tx.txId} tx={tx} />
            ))}
          </div>
        </ScrollArea>
      </motion.div>
    </div>
  );
}
