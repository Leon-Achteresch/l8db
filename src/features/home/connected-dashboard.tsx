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
import { HomeAtlas } from "./atlas/home-atlas";
import { HomeAddWidgetMenu } from "./home-add-widget-menu";
import { HomeGrid } from "./home-grid";
import { InventoryLine } from "./inventory-line";

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

  function toggleEditing() {
    setEditing(!editing);
    if (!editing)
      requestAnimationFrame(() =>
        document
          .getElementById("home-pinboard")
          ?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }),
      );
  }

  function newQuery() {
    const id = useTableTabs.getState().openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  }

  return (
    <main className="workspace-canvas flex-1 overflow-auto" data-tour="dashboard">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="@container/home relative isolate mx-auto max-w-[1440px] px-6 py-7"
      >
        <header className="mb-6 grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="eyebrow">{provider.name}</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="max-w-72 truncate font-mono">{endpoint.host}</span>
              <span className="text-muted-foreground/40">·</span>
              <span>
                {connection.ssh?.host ? "SSH-Tunnel · " : ""}TLS{" "}
                {connection.sslMode === "disable" ? "deaktiviert" : connection.sslMode}
              </span>
              <AnimatedBadge
                size="sm"
                className="ml-1"
                status={tables.isError ? "danger" : tables.isPending ? "loading" : "success"}
              >
                {tables.isError ? "Verbindung prüfen" : tables.isPending ? "Lädt" : "Verbunden"}
              </AnimatedBadge>
            </div>
            <h1 className="text-[26px] font-semibold tracking-tight">{connection.name}</h1>
            <div className="mt-1">
              <InventoryLine database={database} schema={schema} />
            </div>
          </div>
          <div className="flex items-center gap-2" data-tour="dashboard-actions">
            <DisconnectButton />
            <Button
              ref={customize.ref}
              variant="outline"
              size="sm"
              aria-pressed={editing}
              onClick={toggleEditing}
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
        <HomeAtlas connection={connection} />
        <section aria-labelledby="home-pinboard" className="mt-8">
          <h2 id="home-pinboard" className="eyebrow mb-3">
            Pinnwand
          </h2>
          {editing && (
            <section
              aria-label="Pinnwand anpassen"
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
                    if (
                      window.confirm("Alle Widgets von der Pinnwand dieser Verbindung entfernen?")
                    )
                      resetLayout(connection.id);
                  }}
                >
                  Leeren
                </Button>
                <HomeAddWidgetMenu connectionId={connection.id} />
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                  <Check className="size-3.5" />
                  Fertig
                </Button>
              </div>
            </section>
          )}
          <HomeGrid connectionId={connection.id} editing={editing} onAddWidget={toggleEditing} />
        </section>
      </motion.div>
    </main>
  );
}
