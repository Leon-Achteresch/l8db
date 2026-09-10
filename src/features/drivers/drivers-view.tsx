import { PlugZap, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DriverCard } from "@/features/drivers/driver-card";
import { type DatabaseKind, installDriver } from "@/lib/db";
import { summarizeDrivers } from "@/lib/drivers";
import { loadProviders, refreshDriverStatus, useProvidersStore } from "@/lib/providers";
import { cn } from "@/lib/utils";

export function DriversView() {
  const providers = useProvidersStore((state) => state.providers);
  const loaded = useProvidersStore((state) => state.loaded);
  const [installing, setInstalling] = useState<DatabaseKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [logs, setLogs] = useState<Partial<Record<DatabaseKind, string>>>({});

  const summaries = useMemo(() => summarizeDrivers(providers), [providers]);
  const ready = summaries.filter((summary) => summary.status.available).length;

  useEffect(() => {
    if (!loaded) void loadProviders();
  }, [loaded]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await loadProviders();
    } finally {
      setRefreshing(false);
    }
  };

  const handleInstall = async (kind: DatabaseKind, title: string) => {
    if (!window.confirm(`„${title}" jetzt installieren? Das kann einige Minuten dauern.`)) return;
    setInstalling(kind);
    try {
      const log = await installDriver(kind);
      setLogs((prev) => ({ ...prev, [kind]: log || "Installation abgeschlossen." }));
      await loadProviders();
      toast.success(`„${title}" installiert.`);
    } catch (err) {
      const message = typeof err === "string" ? err : String(err);
      setLogs((prev) => ({ ...prev, [kind]: message }));
      toast.error(message);
    } finally {
      setInstalling(null);
    }
  };

  const handleRecheck = async (kind: DatabaseKind) => {
    try {
      await refreshDriverStatus(kind);
    } catch {
      return;
    }
  };

  return (
    <main className="h-full min-h-0 w-full overflow-y-auto p-8">
      <div className="flex items-center gap-2">
        <PlugZap className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold">Treiber</h1>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          disabled={refreshing}
          onClick={() => void refreshAll()}
        >
          <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
          Aktualisieren
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {ready} von {summaries.length} Treiberfamilien bereit. Fehlende Treiber lassen sich direkt
        installieren oder manuell nach Anleitung einrichten.
      </p>

      {refreshing && summaries.length === 0 ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Treiberstatus wird geladen …
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map((summary) => (
            <DriverCard
              key={summary.kind}
              summary={summary}
              installing={installing === summary.kind}
              busy={installing !== null || refreshing}
              log={logs[summary.kind]}
              onInstall={(kind) => void handleInstall(kind, summary.title)}
              onRecheck={(kind) => void handleRecheck(kind)}
            />
          ))}
        </div>
      )}
    </main>
  );
}
