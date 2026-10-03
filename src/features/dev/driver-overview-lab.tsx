import { useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseKind, DriverStatus } from "@/lib/db";
import { summarizeDrivers } from "@/lib/drivers";
import { useProvidersStore } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { DriverHealthVariant } from "./driver-overview/driver-health-variant";
import { DriverInspectorVariant } from "./driver-overview/driver-inspector-variant";
import { DriverListVariant } from "./driver-overview/driver-list-variant";
import { DriverMosaicVariant } from "./driver-overview/driver-mosaic-variant";

const SAMPLE_MISSING: Partial<Record<DatabaseKind, DriverStatus>> = {
  oracle: {
    available: false,
    detail: "Oracle Instant Client wurde nicht gefunden. l8db lädt libclntsh zur Laufzeit.",
    install: [
      {
        os: "macos",
        command: "brew install instantclient-basic",
        url: "https://www.oracle.com/database/technologies/instant-client.html",
      },
    ],
    install_command: "brew install instantclient-basic",
  },
  mssql: {
    available: false,
    detail:
      "Microsoft ODBC Driver 18 for SQL Server fehlt. Ohne ihn sind Windows-Authentifizierung und Kerberos nicht verfügbar.",
    install: [
      {
        os: "macos",
        command: "brew install msodbcsql18",
        url: "https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server",
      },
    ],
    install_command: null,
  },
  odbc: {
    available: false,
    detail:
      "Kein ODBC-Treiber eines Herstellers registriert. Der Treibermanager ist in l8db enthalten.",
    install: [{ os: "all", command: "odbcinst -q -d", url: "https://www.unixodbc.org/" }],
    install_command: null,
  },
};

const variants = [
  {
    id: "list",
    title: "Kompakte Liste",
    description:
      "Eine Zeile pro Treiber, fehlende oben. Filter und Suche über Treiber und Anbieter, Logos der Anbieter als Stapel.",
    View: DriverListVariant,
  },
  {
    id: "mosaic",
    title: "Logo-Raster",
    description:
      "Marken zuerst: fehlende Treiber erscheinen entsättigt. Ein Klick öffnet darunter Anbieter, Befehl und Installation.",
    View: DriverMosaicVariant,
  },
  {
    id: "inspector",
    title: "Liste mit Detailansicht",
    description:
      "Wie in den Systemeinstellungen: links alle Familien, rechts die ausgewählte mit Einrichtung und allen Anbietern.",
    View: DriverInspectorVariant,
  },
  {
    id: "health",
    title: "Zustand auf einen Blick",
    description:
      "Ein Balken mit allen Familien zeigt den Gesamtzustand. Darunter nur, was zu tun ist, Bereites bleibt kompakt.",
    View: DriverHealthVariant,
  },
] as const;

export function DriverOverviewLab() {
  const providers = useProvidersStore((state) => state.providers);
  const [simulate, setSimulate] = useState(true);
  const [installed, setInstalled] = useState<Set<DatabaseKind>>(new Set());
  const [installing, setInstalling] = useState<DatabaseKind | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const summaries = useMemo(() => {
    const patched = providers.map((provider) => {
      const sample =
        simulate && !installed.has(provider.kind) ? SAMPLE_MISSING[provider.kind] : undefined;
      if (sample) return { ...provider, driver_status: sample };
      if (installed.has(provider.kind)) {
        return { ...provider, driver_status: { ...provider.driver_status, available: true } };
      }
      return provider;
    });
    return summarizeDrivers(patched);
  }, [providers, simulate, installed]);

  const install = (kind: DatabaseKind) => {
    setInstalling(kind);
    timer.current = setTimeout(() => {
      setInstalled((prev) => new Set(prev).add(kind));
      setInstalling(null);
    }, 1400);
  };

  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    setInstalling(null);
    setInstalled(new Set());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Treiber-Übersicht</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Vier Entwürfe für die Treiberseite mit den echten {summaries.length} Familien und Logos
            aus thesvg. Installieren ist hier nur simuliert.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            aria-pressed={simulate}
            onClick={() => setSimulate(!simulate)}
            className={cn(
              "h-8 cursor-pointer rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              simulate && "bg-muted",
            )}
          >
            Fehlende Treiber simulieren
          </button>
          <button
            type="button"
            onClick={reset}
            className="h-8 cursor-pointer rounded-md px-3 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            Zurücksetzen
          </button>
        </div>
      </div>
      {summaries.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Keine Treiberdaten geladen. Starte die App mit „bun run tauri dev“, damit die Registry
          verfügbar ist.
        </p>
      ) : (
        <div className="space-y-10">
          {variants.map(({ id, title, description, View }) => (
            <section key={id} aria-labelledby={`driver-${id}`} className="min-w-0 space-y-3">
              <div className="space-y-1">
                <h3 id={`driver-${id}`} className="text-sm font-semibold">
                  {title}
                </h3>
                <p className="max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-sidebar/45 p-4 sm:p-6">
                <View
                  summaries={summaries}
                  installing={installing}
                  onInstall={install}
                  onRecheck={() => undefined}
                />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
