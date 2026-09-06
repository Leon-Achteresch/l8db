import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Database, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { connectionSummary } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { activateConnectionWithToast } from "@/lib/ssh";
import { ConnectedDashboard } from "./connected-dashboard";

export function HomeView() {
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnection = useActiveConnection();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!connections.length) void navigate({ to: "/connections" });
  }, [connections.length, navigate]);
  if (activeConnection)
    return <ConnectedDashboard key={activeConnection.id} connection={activeConnection} />;
  return (
    <main className="workspace-canvas flex flex-1 flex-col items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-lg">
        <div className="mb-6 grid size-12 place-items-center rounded-2xl border bg-card">
          <Database className="size-6 text-primary" />
        </div>
        <p className="eyebrow">Dein Arbeitsplatz</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Mit welcher Datenbank arbeiten wir?
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Wähle eine Verbindung, um Tabellen und Abfragen zu öffnen.
        </p>
        <div className="my-7 space-y-2">
          {connections.map((connection) => (
            <button
              type="button"
              key={connection.id}
              disabled={Boolean(connectingId)}
              onClick={async () => {
                setConnectingId(connection.id);
                try {
                  await activateConnectionWithToast(connection.id);
                } finally {
                  setConnectingId(null);
                }
              }}
              className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-60"
            >
              <Database className="size-4 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{connection.name}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {connectingId === connection.id
                    ? "Verbindung wird geprüft…"
                    : connectionSummary(connection.connectionString, connection.kind).host}
                </span>
              </span>
              <ArrowUpRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
        <Button variant="outline" asChild>
          <Link to="/connections">
            <Plus className="size-4" />
            Verbindungen verwalten
          </Link>
        </Button>
      </div>
    </main>
  );
}
