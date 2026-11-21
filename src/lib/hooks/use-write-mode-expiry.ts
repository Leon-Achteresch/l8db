import { useEffect } from "react";
import { toast } from "sonner";
import { useWriteModeStore } from "@/lib/environments";
import { finishManagedTransaction } from "@/lib/managed-transactions";
import { useSettingsStore } from "@/lib/settings";
import { useTransactionStore } from "@/lib/transactions";

export function useWriteModeExpiry() {
  const unlocked = useWriteModeStore((state) => Object.keys(state.unlockedUntil).length > 0);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const [connectionId, until] of Object.entries(
        useWriteModeStore.getState().unlockedUntil,
      )) {
        if (until > now) continue;
        useWriteModeStore.getState().lock(connectionId);
        toast.info("Schreibmodus für Produktion beendet.");
        if (!useSettingsStore.getState().productionAutoRollback) continue;
        for (const tx of useTransactionStore
          .getState()
          .transactions.filter((entry) => entry.connectionId === connectionId)) {
          void finishManagedTransaction(tx.txId, false)
            .then(() => toast.warning("Offene Produktions-Transaktion automatisch zurückgerollt."))
            .catch((error) => toast.error(String(error)));
        }
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [unlocked]);
}
