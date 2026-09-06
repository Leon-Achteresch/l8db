import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
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
import { useConnectionsStore } from "@/lib/connections";
import { activateConnectionWithToast } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection } from "@/lib/transactions";
import { ConnectionAddTile } from "./connection-add-tile";
import { ConnectionEditor } from "./connection-editor";
import { ConnectionPickCard } from "./connection-pick-card";
import { SavedConnectionChip } from "./saved-connection-chip";

export function ConnectionsView() {
  const connections = useConnectionsStore((state) => state.connections);
  const activeId = useConnectionsStore((state) => state.activeId);
  const [editorId, setEditorId] = useState<string | null>(connections.length ? null : "new");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const navigate = useNavigate();
  const selected = connections.find((connection) => connection.id === editorId);
  const deleting = connections.find((connection) => connection.id === deleteId);

  async function connect(id: string | null) {
    if (connectingId) return;
    setConnectingId(id ?? "disconnect");
    try {
      if (await activateConnectionWithToast(id)) {
        await navigate({ to: "/" });
      }
    } finally {
      setConnectingId(null);
    }
  }

  return (
    <main className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-[1100px] flex-col px-5 py-5">
        <header className="mb-5 flex shrink-0 items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">l8db</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">
              {editorId ? "Verbindung" : "Datenbank wählen"}
            </h1>
            {!editorId && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Verbindung öffnen oder eine neue anlegen.
              </p>
            )}
          </div>
          {connections.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/">
                <ArrowLeft className="size-4" />
                Arbeitsplatz
              </Link>
            </Button>
          )}
        </header>
        {editorId && connections.length > 0 && (
          <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
            {connections.map((connection) => (
              <SavedConnectionChip
                key={connection.id}
                connection={connection}
                active={activeId === connection.id}
                connecting={connectingId === connection.id}
                onOpen={() => {
                  if (activeId === connection.id) void connect(null);
                  else void connect(connection.id);
                }}
                onEdit={() => setEditorId(connection.id)}
                onDelete={() => setDeleteId(connection.id)}
              />
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          {editorId ? (
            <ConnectionEditor
              key={editorId}
              connection={selected}
              onSaved={() => setEditorId(null)}
              onCancel={() => setEditorId(connections.length ? null : "new")}
            />
          ) : (
            <section className="flex min-h-0 flex-1 items-center overflow-y-auto">
              <div className="grid w-full grid-cols-1 gap-4 py-2 sm:grid-cols-2 xl:grid-cols-3">
                {connections.map((connection) => (
                  <ConnectionPickCard
                    key={connection.id}
                    connection={connection}
                    active={activeId === connection.id}
                    connecting={connectingId === connection.id}
                    onOpen={() => {
                      if (activeId === connection.id) void connect(null);
                      else void connect(connection.id);
                    }}
                    onEdit={() => setEditorId(connection.id)}
                    onDelete={() => setDeleteId(connection.id)}
                  />
                ))}
                <ConnectionAddTile onAdd={() => setEditorId("new")} />
              </div>
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
                  useTableTabs.getState().clearTabsForConnection(deleteId);
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
