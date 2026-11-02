import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectionsStore } from "@/lib/connections";
import { saveQueryTabFile } from "@/lib/hooks/use-query-file";
import { type Tab, useTableTabs } from "@/lib/table-tabs";
import { dirtyQueryFiles } from "@/lib/table-tabs-dirty-files";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { useTransactionStore } from "@/lib/transactions";

const NO_TABS: Tab[] = [];
const NO_GROUPS: Record<string, Tab[]> = {};

function hasCloseBlockers() {
  const state = useTableTabs.getState();
  return (
    dirtyQueryFiles(
      state.tabs,
      state.tabsByConnection,
      useConnectionsStore.getState().activeId ?? null,
    ).length > 0 ||
    useTransactionStore.getState().transactions.length > 0 ||
    useTasksStore.getState().tasks.some(isTaskActive)
  );
}

export function WindowCloseGuard() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const allowClose = useRef(false);
  const tabs = useTableTabs((state) => (open ? state.tabs : NO_TABS));
  const groups = useTableTabs((state) => (open ? state.tabsByConnection : NO_GROUPS));
  const connections = useConnectionsStore((state) => state.connections);
  const activeId = useConnectionsStore((state) => state.activeId ?? null);
  const files = dirtyQueryFiles(tabs, groups, activeId);
  const dirty = files.filter((file) => file.active);
  const connectionName = (id: string | null) =>
    connections.find((connection) => connection.id === id)?.name ?? "Ohne Verbindung";
  const transactions = useTransactionStore((state) => state.transactions);
  const activeTasks = useTasksStore((state) =>
    open ? state.tasks.filter(isTaskActive).length : 0,
  );
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowClose.current || !hasCloseBlockers()) return;
        event.preventDefault();
        setOpen(true);
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((error) =>
        toast.error(`Schließschutz konnte nicht aktiviert werden: ${String(error)}`),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const closeWindow = () => {
    allowClose.current = true;
    void getCurrentWindow()
      .close()
      .catch((error) => {
        allowClose.current = false;
        toast.error(String(error));
      });
  };
  const saveFiles = async () => {
    setSaving(true);
    try {
      for (const file of dirty) if (!(await saveQueryTabFile(file.id))) return;
      if (!hasCloseBlockers()) {
        closeWindow();
        return;
      }
      toast.success("Dateien der aktiven Verbindung gespeichert");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fenster schließen?</DialogTitle>
          <DialogDescription>
            Es gibt ungespeicherte Dateien, offene Transaktionen oder laufende Aufgaben.
            SQL-Entwürfe bleiben in der Arbeitsumgebung erhalten; externe Dateien werden dadurch
            nicht gespeichert.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            {files.length} ungespeicherte Dateien · {transactions.length} offene Transaktionen ·{" "}
            {activeTasks} laufende Aufgaben
          </p>
          {files.length > 0 && (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-2 text-xs">
              {files.map((file) => (
                <li key={file.id} className="flex min-w-0 gap-2">
                  <span className="truncate font-medium">{file.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {connectionName(file.connectionId)}
                    {file.active ? " (aktiv)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {files.length > dirty.length && (
            <p className="text-muted-foreground">
              Dateien anderer Verbindungen speichern Sie nach einem Wechsel zu dieser Verbindung.
            </p>
          )}
          <p className="text-muted-foreground">
            Beim Schließen gehen offene Transaktionen und laufende Ergebnisse möglicherweise
            verloren.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpen(false);
                useTransactionStore.getState().setPanelOpen(true);
              }}
            >
              Transaktionen prüfen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpen(false);
                useTasksStore.setState({ open: true });
              }}
            >
              Aufgaben prüfen
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          {dirty.length > 0 && (
            <Button disabled={saving} onClick={() => void saveFiles()}>
              Dateien speichern
            </Button>
          )}
          <Button variant="destructive" disabled={saving} onClick={closeWindow}>
            Trotzdem schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
