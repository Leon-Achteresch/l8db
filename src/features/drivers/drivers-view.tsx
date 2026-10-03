import { CircleCheck, PlugZap, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DriverHealthBar } from "@/features/drivers/driver-health-bar";
import { DriverMissingCard } from "@/features/drivers/driver-missing-card";
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
  const missing = summaries.filter((summary) => !summary.status.available);
  const ready = summaries.filter((summary) => summary.status.available);
  const busy = installing !== null || refreshing;

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
    } catch (error) {
      toast.error(`Treiberstatus konnte nicht geprüft werden: ${String(error)}`);
    }
  };

  return (
    <main className="h-full min-h-0 w-full overflow-y-auto p-8" data-tour="drivers-page">
      <div className="mx-auto max-w-5xl">
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
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          DuckDB und der ODBC-Treibermanager sind in l8db enthalten. Für ODBC-Datenquellen wird nur
          der Treiber des Herstellers benötigt.
        </p>

        {refreshing && summaries.length === 0 ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Treiberstatus wird geladen …
          </div>
        ) : (
          <div className="mt-7 space-y-8">
            <DriverHealthBar summaries={summaries} />

            {missing.length > 0 ? (
              <section aria-labelledby="drivers-missing" className="space-y-3">
                <h2 id="drivers-missing" className="text-sm font-semibold">
                  Braucht deine Aufmerksamkeit
                </h2>
                <div className="grid gap-3 lg:grid-cols-2">
                  {missing.map((summary) => (
                    <DriverMissingCard
                      key={summary.kind}
                      summary={summary}
                      installing={installing === summary.kind}
                      busy={busy}
                      log={logs[summary.kind]}
                      onInstall={() => void handleInstall(summary.kind, summary.title)}
                      onRecheck={() => void handleRecheck(summary.kind)}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleCheck className="size-4 text-emerald-500" />
                Du kannst jede unterstützte Datenbank direkt verbinden.
              </p>
            )}

            {ready.length > 0 && (
              <section aria-labelledby="drivers-ready" className="space-y-3">
                <h2 id="drivers-ready" className="text-sm font-semibold">
                  Einsatzbereit
                </h2>
                <ul className="flex flex-wrap gap-1.5">
                  {ready.map((summary) => (
                    <li
                      key={summary.kind}
                      title={`${summary.typeLabel}: ${summary.providers.map((provider) => provider.name).join(", ")}`}
                      className="inline-flex h-8 items-center gap-2 rounded-full bg-card pr-3 pl-2 text-xs ring-1 ring-border"
                    >
                      <ProviderLogo kind={summary.kind} className="size-4" />
                      {summary.title}
                      <span className="tabular-nums text-muted-foreground">
                        {summary.providers.length}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
