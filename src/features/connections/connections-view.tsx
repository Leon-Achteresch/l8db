import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Database,
  Plus,
  Search,
  Server,
  SquareTerminal,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectionSummary } from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";
import { activateConnectionWithToast } from "@/lib/ssh";
import { getTransactionForConnection } from "@/lib/transactions";
import { ConnectionCard } from "./connection-card";
import { ConnectionEditor } from "./connection-editor";

export function ConnectionsView() {
  const connections = useConnectionsStore((state) => state.connections);
  const activeId = useConnectionsStore((state) => state.activeId);
  const [search, setSearch] = useState("");
  const [editorId, setEditorId] = useState<string | null>(connections.length ? null : "new");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const navigate = useNavigate();
  const visible = connections.filter((connection) =>
    `${connection.name} ${connectionSummary(connection.connectionString, connection.kind).host} ${connection.tags?.map((tag) => tag.name).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected = connections.find((connection) => connection.id === editorId);
  const deleting = connections.find((connection) => connection.id === deleteId);

  async function connect(id: string | null) {
    if (connectingId) return;
    setConnectingId(id ?? "disconnect");
    try {
      if (await activateConnectionWithToast(id)) {
        if (id) await navigate({ to: "/" });
      }
    } finally {
      setConnectingId(null);
    }
  }

  return (
    <main className="workspace-canvas h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-[1320px] px-6 py-8 lg:px-12 lg:py-12">
        <header className="mb-9 flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="mb-4 flex items-center gap-2.5">
              <div className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Database className="size-4" />
              </div>
              <span className="text-sm font-semibold tracking-tight">
                l8db<span className="ml-2 font-normal text-muted-foreground">/ Arbeitsbereich</span>
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              Deine Daten. Dein Arbeitsplatz.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              PostgreSQL verbinden, Daten erkunden und SQL ausführen.
              <br className="hidden sm:block" /> Lokal oder in der Cloud – alles an einem Ort.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            {connections.length > 0 && (
              <Button variant="outline" asChild>
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  Arbeitsplatz
                </Link>
              </Button>
            )}
            <Button onClick={() => setEditorId("new")}>
              <Plus className="size-4" />
              Neue Verbindung
            </Button>
          </div>
        </header>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(390px,0.9fr)] xl:gap-12">
          <section className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Verbindungen{" "}
                <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {connections.length}
                </span>
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {activeId ? "1 aktiv" : "Keine aktive Verbindung"}
              </span>
            </div>
            {connections.length > 0 && (
              <div className="relative mb-4">
                <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
                <Input
                  aria-label="Verbindungen suchen"
                  placeholder="Name, Host oder Tag suchen…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 rounded-xl bg-card pl-9"
                />
              </div>
            )}
            <div className="space-y-3">
              {visible.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  active={activeId === connection.id}
                  busy={Boolean(connectingId)}
                  connecting={connectingId === connection.id}
                  onConnect={() => void connect(connection.id)}
                  onDisconnect={() => void connect(null)}
                  onEdit={() => setEditorId(connection.id)}
                  onDelete={() => setDeleteId(connection.id)}
                />
              ))}
            </div>
            {connections.length === 0 && (
              <div className="connection-empty relative overflow-hidden rounded-2xl border border-dashed px-7 py-12">
                <div className="relative">
                  <div className="mb-7 flex items-center gap-3">
                    <div className="grid size-12 place-items-center rounded-2xl border bg-card shadow-sm">
                      <Server className="size-5 text-primary" />
                    </div>
                    <div className="h-px w-9 bg-border" />
                    <div className="grid size-12 place-items-center rounded-2xl border bg-card shadow-sm">
                      <Database className="size-5 text-primary" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight">
                    Hier beginnt dein nächstes Projekt.
                  </h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                    Füge deine erste Verbindung hinzu. Zugangsdaten bleiben auf deinem Gerät.
                  </p>
                  <div className="mt-7 space-y-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <SquareTerminal className="size-4" />
                      SQL-Editor mit Abfrageverlauf
                    </span>
                    <span className="flex items-center gap-2">
                      <Database className="size-4" />
                      Tabellen, Schemas und Inline-Bearbeitung
                    </span>
                    <span className="flex items-center gap-2">
                      <Workflow className="size-4" />
                      Beziehungen und Transaktionen
                    </span>
                  </div>
                </div>
              </div>
            )}
            {connections.length > 0 && visible.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Keine Verbindung für „{search}“ gefunden.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                  Suche zurücksetzen
                </Button>
              </div>
            )}
            <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />
              PostgreSQL · Supabase · Neon · weitere PostgreSQL-Hosts
            </div>
          </section>
          {editorId ? (
            <ConnectionEditor
              key={editorId}
              connection={selected}
              onSaved={() => setEditorId(null)}
              onCancel={() => setEditorId(null)}
            />
          ) : (
            <section className="rounded-2xl border bg-card p-8">
              <p className="eyebrow">Bereit für deine Daten</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Ein Zugang.
                <br />
                Alle Möglichkeiten.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Wähle eine gespeicherte Verbindung oder richte einen weiteren PostgreSQL-Server ein.
                Jede Verbindung erhält eigene Zugangsdaten, TLS-Einstellungen und optional einen
                SSH-Tunnel.
              </p>
              <Button className="mt-6" onClick={() => setEditorId("new")}>
                Verbindung einrichten
                <ArrowUpRight className="size-4" />
              </Button>
            </section>
          )}
        </div>
      </div>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verbindung entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{deleting?.name}“ und die gespeicherten Zugangsdaten werden aus l8db entfernt. Die
              Datenbank selbst bleibt erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) {
                  if (getTransactionForConnection(deleteId)) {
                    toast.error("Schließe zuerst die offene Transaktion ab.");
                    return;
                  }
                  useConnectionsStore.getState().removeConnection(deleteId);
                  if (editorId === deleteId) setEditorId(null);
                  toast.success("Verbindung entfernt");
                  setDeleteId(null);
                }
              }}
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
