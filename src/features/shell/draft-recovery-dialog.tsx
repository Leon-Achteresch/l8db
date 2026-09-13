import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { useObjectDrafts } from "@/lib/object-drafts";
import { activateConnectionWithToast } from "@/lib/ssh";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import { useTableTabs } from "@/lib/table-tabs";

interface DraftRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DraftRecoveryDialog({ open, onOpenChange }: DraftRecoveryDialogProps) {
  const navigate = useNavigate();
  const closed = useTableTabs((state) => state.recentlyClosed);
  const drafts = useObjectDrafts((state) => state.drafts);
  const connections = useConnectionsStore((state) => state.connections);
  const [busy, setBusy] = useState(false);
  const activate = async (id: string | null | undefined) => {
    if (id === useConnectionsStore.getState().activeId) return true;
    return activateConnectionWithToast(id ?? null);
  };
  const restore = async (id: string) => {
    setBusy(true);
    try {
      const tab = useTableTabs.getState().recentlyClosed.find((entry) => entry.recoveryId === id);
      if (!tab || !(await activate(tab.closedConnectionId))) return;
      const restored = useTableTabs.getState().reopenClosedTab(id);
      if (restored) navigateToTab(navigate, restored);
      onOpenChange(false);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  const openObject = async (key: string) => {
    const draft = useObjectDrafts.getState().drafts[key];
    if (!draft) return;
    setBusy(true);
    try {
      if (!(await activate(draft.connectionId))) return;
      if (draft.database)
        useDbSelectionStore.getState().setDatabase(draft.connectionId, draft.database);
      const id = useTableTabs.getState().openQueryTabWithSql(draft.sql, `${draft.title} · Entwurf`);
      void navigate({ to: "/query/$id", params: { id } });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Entwürfe wiederherstellen</DialogTitle>
          <DialogDescription>
            Die letzten 100 geschlossenen Tabs und lokal gesicherte Objektentwürfe. Beim Öffnen wird
            die ursprüngliche Verbindung verwendet.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-auto">
          {!closed.length && !Object.keys(drafts).length && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Keine geschlossenen Tabs oder Objektentwürfe.
            </p>
          )}
          {closed.map((tab) => (
            <div key={tab.recoveryId} className="flex items-center gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{tabLabel(tab)}</p>
                <p className="text-xs text-muted-foreground">
                  {tab.closedConnectionName ?? "Ohne Verbindung"} · {tab.closedDatabase} ·{" "}
                  {tab.closedAt ? new Date(tab.closedAt).toLocaleString("de-DE") : ""}
                </p>
              </div>
              <Button
                size="sm"
                disabled={
                  busy ||
                  Boolean(
                    tab.closedConnectionId &&
                      !connections.some((entry) => entry.id === tab.closedConnectionId),
                  )
                }
                onClick={() => tab.recoveryId && void restore(tab.recoveryId)}
              >
                Wiederöffnen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (!tab.recoveryId) return;
                  useTableTabs.getState().forgetClosedTab(tab.recoveryId);
                  toast("Entwurf entfernt", {
                    action: {
                      label: "Rückgängig",
                      onClick: () =>
                        useTableTabs.setState((state) => ({
                          recentlyClosed: [tab, ...state.recentlyClosed].slice(0, 100),
                        })),
                    },
                  });
                }}
              >
                Entfernen
              </Button>
            </div>
          ))}
          {Object.values(drafts).map((draft) => (
            <div key={draft.key} className="flex items-center gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{draft.title}</p>
                <p className="text-xs text-muted-foreground">
                  {connections.find((entry) => entry.id === draft.connectionId)?.name ??
                    "Verbindung entfernt"}{" "}
                  · {draft.database} · Objektentwurf
                </p>
              </div>
              <Button
                size="sm"
                disabled={busy || !connections.some((entry) => entry.id === draft.connectionId)}
                onClick={() => void openObject(draft.key)}
              >
                Als SQL öffnen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  useObjectDrafts.getState().remove(draft.key);
                  toast("Entwurf entfernt", {
                    action: {
                      label: "Rückgängig",
                      onClick: () => useObjectDrafts.getState().put(draft),
                    },
                  });
                }}
              >
                Verwerfen
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
