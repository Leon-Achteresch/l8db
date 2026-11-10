import { CheckIcon, XIcon } from "lucide-react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveConnection } from "@/lib/connections";
import { EASE_OUT } from "@/lib/ease";
import { useCapabilities } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { useTransactionStore } from "@/lib/transactions";
import { TransactionCard } from "./transaction-card";

function commitFrom(target: HTMLElement | null, panel: HTMLElement) {
  const card =
    target?.closest("[data-tx-id]") ??
    (panel.querySelectorAll("[data-tx-id]").length === 1
      ? panel.querySelector("[data-tx-id]")
      : null);
  const commit = card?.querySelector<HTMLButtonElement>("[data-tx-commit]:not(:disabled)");
  commit?.click();
  return !!commit;
}

export function TransactionPanel() {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const connection = useActiveConnection();
  const capabilities = useCapabilities(connection?.kind);
  const perTable = useSettingsStore((state) => state.transactionsPerTable);
  const transactions = useTransactionStore((s) => s.transactions);
  const setPanelOpen = useTransactionStore((s) => s.setPanelOpen);
  const prevCount = useRef(transactions.length);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (prevCount.current > 0 && transactions.length === 0) setPanelOpen(false);
    prevCount.current = transactions.length;
  }, [transactions.length, setPanelOpen]);

  useEffect(() => {
    if (!present) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const panel = sectionRef.current;
      if (!panel || event.key !== "Enter" || event.shiftKey || event.altKey || event.repeat) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inPanel = !!target && panel.contains(target);
      const fromGrid =
        !target ||
        target === document.body ||
        (!!target.closest("[data-grid-scroll]") &&
          !target.closest("input, textarea, select, [contenteditable]"));
      if (!inPanel && !fromGrid) return;
      if (!commitFrom(inPanel ? target : null, panel)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [present]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.repeat) return;
    if (event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [contenteditable]")) return;
    if (!commitFrom(target, event.currentTarget)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <motion.section
      initial={reduced ? { opacity: 0.8 } : { opacity: 0.5, x: "100%", scale: 0.985 }}
      animate={{ opacity: 1, x: "0%", scale: 1 }}
      exit={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, x: "100%", scale: 0.985, transition: { duration: 0.2, ease: EASE_OUT } }
      }
      transition={
        reduced ? { duration: 0.1 } : { type: "spring", stiffness: 360, damping: 34, mass: 0.9 }
      }
      inert={!present}
      aria-hidden={!present}
      data-tour="tx-panel"
      aria-label="Transaktionen"
      ref={sectionRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute inset-y-0 right-0 z-30 flex w-[380px] max-w-full min-h-0 origin-right bg-card shadow-2xl shadow-black/20 outline-none"
    >
      <div className="flex h-full w-full min-w-0 flex-col border-l border-border bg-card">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <span className="text-xs font-semibold text-foreground">Transaktionen</span>
          {transactions.length > 0 && (
            <span className="inline-flex size-4 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-600 dark:text-amber-400">
              {transactions.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Transaktionen schließen"
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
                  <CheckIcon className="size-5 text-muted-foreground" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  Keine offenen Transaktionen
                </p>
                <p className="max-w-[220px] text-[10px] leading-relaxed text-muted-foreground">
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
      </div>
    </motion.section>
  );
}
