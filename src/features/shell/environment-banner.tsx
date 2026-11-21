import { LockKeyhole, ShieldAlert, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SavedConnection } from "@/lib/connections";
import {
  useConnectionEnvironment,
  useWriteModeRemaining,
  useWriteModeStore,
  WRITE_MODE_MINUTES,
} from "@/lib/environments";
import { useSettingsStore } from "@/lib/settings";

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function EnvironmentBanner({ connection }: { connection: SavedConnection | null }) {
  const environment = useConnectionEnvironment(connection);
  const productionReadOnly = useSettingsStore((state) => state.productionReadOnly);
  const remaining = useWriteModeRemaining(connection?.id);

  if (!connection || environment?.value !== "production") return null;

  return (
    <div
      role="status"
      aria-label="Produktionsumgebung"
      className="@container flex h-8 shrink-0 items-center gap-2 px-3 text-xs font-medium whitespace-nowrap text-white"
      style={{ backgroundColor: environment.color }}
    >
      <ShieldAlert className="size-4 shrink-0" />
      <span className="uppercase tracking-wide">Produktion</span>
      <span className="min-w-0 truncate opacity-90">{connection.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {productionReadOnly && remaining === null && (
          <>
            <span title="Schreibgeschützt" className="flex items-center gap-1 opacity-90">
              <LockKeyhole className="size-3.5" />
              <span className="hidden @xl:inline">Schreibgeschützt</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-xs"
              aria-label={`Schreibmodus für ${WRITE_MODE_MINUTES} min aktivieren`}
              onClick={() => useWriteModeStore.getState().unlock(connection.id)}
            >
              <Unlock className="size-3.5" />
              <span className="hidden @2xl:inline">
                Schreibmodus für {WRITE_MODE_MINUTES} min aktivieren
              </span>
              <span className="@2xl:hidden">{WRITE_MODE_MINUTES} min</span>
            </Button>
          </>
        )}
        {productionReadOnly && remaining !== null && (
          <>
            <span className="tabular-nums">
              <span className="hidden @lg:inline">Schreibmodus aktiv · </span>
              {formatRemaining(remaining)}
            </span>
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
