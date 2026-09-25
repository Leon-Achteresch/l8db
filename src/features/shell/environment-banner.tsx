import { LockKeyhole, ShieldAlert, Unlock } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import {
  useConnectionEnvironment,
  useWriteModeRemaining,
  useWriteModeStore,
  WRITE_MODE_MINUTES,
} from "@/lib/environments";
import { finishManagedTransaction } from "@/lib/managed-transactions";
import { useSettingsStore } from "@/lib/settings";
import { useTransactionStore } from "@/lib/transactions";

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function EnvironmentBanner() {
  const connection = useActiveConnection();
  const environment = useConnectionEnvironment(connection);
  const productionReadOnly = useSettingsStore((state) => state.productionReadOnly);
  const remaining = useWriteModeRemaining(connection?.id);
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

  if (!connection || environment?.value !== "production") return null;

  return (
    <div
      role="status"
      aria-label="Produktionsumgebung"
      className="flex h-8 shrink-0 items-center gap-2 px-3 text-xs font-medium text-white"
      style={{ backgroundColor: environment.color }}
    >
      <ShieldAlert className="size-4" />
      <span className="uppercase tracking-wide">Produktion</span>
      <span className="truncate opacity-90">{connection.name}</span>
      <span className="ml-auto flex items-center gap-2">
        {productionReadOnly && remaining === null && (
          <>
            <span className="flex items-center gap-1 opacity-90">
              <LockKeyhole className="size-3.5" /> Schreibgeschützt
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-xs"
              onClick={() => useWriteModeStore.getState().unlock(connection.id)}
            >
              <Unlock className="size-3.5" />
              Schreibmodus für {WRITE_MODE_MINUTES} min aktivieren
            </Button>
          </>
        )}
        {productionReadOnly && remaining !== null && (
          <>
            <span className="tabular-nums">Schreibmodus aktiv · {formatRemaining(remaining)}</span>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-xs"
              onClick={() => useWriteModeStore.getState().unlock(connection.id, 0)}
            >
              <LockKeyhole className="size-3.5" />
              Beenden
            </Button>
          </>
        )}
      </span>
    </div>
  );
}
