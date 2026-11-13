import { CircleCheck, PlugZap, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DriverHealthBar } from "@/features/drivers/driver-health-bar";
import { DriverMissingCard } from "@/features/drivers/driver-missing-card";
import {
  type DatabaseKind,
  type DriverDiagnosis,
  diagnoseDriver,
  installDriver,
  repairDriver,
} from "@/lib/db";
import { diagnosableKinds, summarizeDrivers } from "@/lib/drivers";
import {
  loadProviders,
  refreshDriverStatus,
  setDriverStatus,
  useProvidersStore,
} from "@/lib/providers";
import { cn } from "@/lib/utils";
import { JdbcManager } from "./jdbc-manager";

export function DriversView() {
  const providers = useProvidersStore((state) => state.providers);
  const loaded = useProvidersStore((state) => state.loaded);
  const [installing, setInstalling] = useState<DatabaseKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [logs, setLogs] = useState<Partial<Record<DatabaseKind, string>>>({});
  const [diagnoses, setDiagnoses] = useState<Partial<Record<DatabaseKind, DriverDiagnosis>>>({});
  const [analyzing, setAnalyzing] = useState<DatabaseKind | null>(null);
  const diagnosed = useRef(false);

  const summaries = useMemo(
    () =>
      summarizeDrivers(
        providers.map((provider) => {
          const status = diagnoses[provider.kind]?.status;
          return status ? { ...provider, driver_status: status } : provider;
        }),
      ),
    [providers, diagnoses],
  );
  const missing = summaries.filter((summary) => !summary.status.available);
  const ready = summaries.filter((summary) => summary.status.available);
  const busy = installing !== null || refreshing || analyzing !== null;

  const applyDiagnosis = useCallback((kind: DatabaseKind, diagnosis: DriverDiagnosis) => {
    setDriverStatus(kind, diagnosis.status);
    setDiagnoses((prev) => ({ ...prev, [kind]: diagnosis }));
  }, []);

  const diagnose = useCallback(
    async (kind: DatabaseKind) => {
      setAnalyzing(kind);
      try {
        applyDiagnosis(kind, await diagnoseDriver(kind));
      } catch (error) {
        toast.error(`Treiber konnte nicht analysiert werden: ${String(error)}`);
      } finally {
        setAnalyzing(null);
      }
    },
    [applyDiagnosis],
  );

  useEffect(() => {
    if (!loaded) void loadProviders();
  }, [loaded]);

  useEffect(() => {
    if (!loaded || diagnosed.current) return;
    diagnosed.current = true;
    for (const kind of diagnosableKinds(providers)) void diagnose(kind);
  }, [loaded, providers, diagnose]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await loadProviders();
      await refreshDriverStatus("jdbc");
      await Promise.all(diagnosableKinds(useProvidersStore.getState().providers).map(diagnose));
    } catch (error) {
      toast.error(`Treiberstatus konnte nicht geprüft werden: ${String(error)}`);
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

  const handleRepair = async (kind: DatabaseKind, title: string) => {
    setInstalling(kind);
    try {
      const { log, diagnosis } = await repairDriver(kind);
      setLogs((prev) => ({ ...prev, [kind]: log }));
      applyDiagnosis(kind, diagnosis);
      if (diagnosis.status.available) toast.success(`„${title}" repariert.`);
      else toast.error(`„${title}" ist noch nicht einsatzbereit.`);
    } catch (err) {
      const message = typeof err === "string" ? err : String(err);
      setLogs((prev) => ({ ...prev, [kind]: message }));
      toast.error(message);
    } finally {
      setInstalling(null);
    }
  };

  const handleRecheck = async (kind: DatabaseKind) => {
    if (diagnosableKinds(providers).includes(kind)) return diagnose(kind);
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
                      analyzing={analyzing === summary.kind}
                      diagnosis={diagnoses[summary.kind]}
                      log={logs[summary.kind]}
                      onInstall={() => void handleInstall(summary.kind, summary.title)}
                      onRepair={() => void handleRepair(summary.kind, summary.title)}
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
        <JdbcManager />
      </div>
    </main>
  );
}
