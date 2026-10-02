import { useNavigate } from "@tanstack/react-router";
import { Check, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { DisconnectButton } from "@/features/connections/disconnect-button";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { useHomeLayoutStore } from "@/lib/home-layout";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useRefreshConnection, useTablesQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";
import { HomeAddWidgetMenu } from "./home-add-widget-menu";
import { HomeGrid } from "./home-grid";

export function ConnectedDashboard({ connection }: { connection: SavedConnection }) {
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const tables = useTablesQuery();
  const { refresh, isRefreshing } = useRefreshConnection();
  const customized = useHomeLayoutStore((state) => connection.id in state.layouts);
  const resetLayout = useHomeLayoutStore((state) => state.resetLayout);
  const [editing, setEditing] = useState(false);
  const customize = useNewFeatureVisibility<HTMLButtonElement>("home.customize");
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  const provider = providerFor(connection);
  const caps = provider.capabilities;

  function newQuery() {
    const id = useTableTabs.getState().openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  }

  return (
    <main className="workspace-canvas flex-1 overflow-auto" data-tour="dashboard">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-[1400px] px-6 py-8 lg:px-9"
      >
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="eyebrow">Arbeitsplatz</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-[11px] text-muted-foreground">{provider.name}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">{connection.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{database}</span>
              {caps.schemas && (
                <>
                  <span className="size-1 rounded-full bg-border" />
                  <span>Schema {schema}</span>
                </>
              )}
              <span className="size-1 rounded-full bg-border" />
              <span className="max-w-72 truncate">{endpoint.host}</span>
            </p>
          </div>
          <div className="flex items-center gap-2" data-tour="dashboard-actions">
            <DisconnectButton />
            <Button
              ref={customize.ref}
              variant="outline"
              size="sm"
              aria-pressed={editing}
              onClick={() => setEditing((current) => !current)}
            >
              <SlidersHorizontal className="size-3.5" />
              Anpassen
              {customize.isNew && <NewBadge />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Übersicht aktualisieren"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={newQuery}>
              <Plus className="size-3.5" />
              {caps.query_language === "sql" ? "SQL-Abfrage" : "Abfrage"}
            </Button>
          </div>
        </header>
        <div className="mb-6 flex items-center gap-3">
          <AnimatedBadge
            size="sm"
            status={tables.isError ? "danger" : tables.isPending ? "loading" : "success"}
          >
            {tables.isError
              ? "Verbindung prüfen"
              : tables.isPending
                ? "Objekte laden"
                : "Daten geladen"}
          </AnimatedBadge>
          <span className="text-[11px] text-muted-foreground">
            {connection.ssh?.host ? "SSH-Tunnel · " : ""}TLS{" "}
            {connection.sslMode === "disable" ? "deaktiviert" : connection.sslMode}
          </span>
        </div>
        {editing && (
          <section
            aria-label="Startseite anpassen"
            className="sticky top-3 z-20 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-popover px-4 py-2.5 shadow-sm"
          >
            <p className="text-xs text-muted-foreground">
              Widgets ziehen, an der Ecke in der Größe ändern oder entfernen.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!customized}
                onClick={() => {
                  if (window.confirm("Startseite dieser Verbindung auf den Standard zurücksetzen?"))
                    resetLayout(connection.id);
                }}
              >
                Zurücksetzen
              </Button>
              <HomeAddWidgetMenu connectionId={connection.id} />
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                <Check className="size-3.5" />
                Fertig
              </Button>
            </div>
          </section>
        )}
        <HomeGrid connectionId={connection.id} editing={editing} />
      </motion.div>
    </main>
  );
}
