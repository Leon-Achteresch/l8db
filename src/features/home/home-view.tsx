import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { SPRING_LAYOUT } from "@/lib/ease";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { ConnectedDashboard } from "./connected-dashboard";

export function HomeView() {
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const connectingId = isSwitching ? switchTargetId : null;
  const navigate = useNavigate();
  useEffect(() => {
    if (!connections.length) void navigate({ to: "/connections" });
  }, [connections.length, navigate]);
  if (activeConnection)
    return <ConnectedDashboard key={activeConnection.id} connection={activeConnection} />;
  return (
    <main className="workspace-canvas flex flex-1 flex-col overflow-auto p-8">
      <div className="w-full">
        <p className="text-[11px] font-semibold text-muted-foreground">Arbeitsplatz</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Mit welcher Datenbank arbeiten wir?
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Wähle eine Verbindung, um Tabellen und Abfragen zu öffnen.
        </p>
        <div
          className="my-7 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          data-tour="home-pick"
        >
          {connections.map((connection) => {
            const provider = providerFor(connection);
            return (
              <motion.button
                type="button"
                key={connection.id}
                layout
                transition={{ layout: SPRING_LAYOUT }}
                disabled={isSwitching}
                onClick={() => {
                  void activateConnectionWithToast(connection.id);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/45 disabled:opacity-60"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-background ring-1 ring-border">
                  <ProviderLogo
                    providerId={provider.id}
                    kind={connection.kind}
                    className="size-5"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ConnectionStatusIndicator connectionId={connection.id} />
                    <span className="truncate text-sm font-medium">{connection.name}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {connectingId === connection.id
                      ? "Verbindung wird geprüft…"
                      : connectionSummary(connection.connectionString, connection.kind).host}
                  </span>
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </motion.button>
            );
          })}
        </div>
        <Button variant="outline" className="self-start" asChild>
          <Link to="/connections">
            <Plus className="size-4" />
            Verbindungen verwalten
          </Link>
        </Button>
      </div>
    </main>
  );
}
