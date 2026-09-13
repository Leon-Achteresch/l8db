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
import { saveQueryTabFile } from "@/lib/hooks/use-query-file";
import { isQueryTabDirty, useTableTabs } from "@/lib/table-tabs";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { useTransactionStore } from "@/lib/transactions";

export function WindowCloseGuard() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const allowClose = useRef(false);
  const tabs = useTableTabs((state) => state.tabs);
  const dirty = tabs.filter((tab) => tab.kind === "query" && isQueryTabDirty(tab));
  const transactions = useTransactionStore((state) => state.transactions);
  const tasks = useTasksStore((state) => state.tasks);
  const activeTasks = tasks.filter(isTaskActive);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowClose.current) return;
        const state = useTableTabs.getState();
        const allTabs = [...state.tabs, ...Object.values(state.tabsByConnection).flat()];
        if (
          !allTabs.some((tab) => tab.kind === "query" && isQueryTabDirty(tab)) &&
          !useTransactionStore.getState().transactions.length &&
          !useTasksStore.getState().tasks.some(isTaskActive)
        )
          return;
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
  const saveFiles = async () => {
    setSaving(true);
    try {
      for (const tab of dirty)
        if (tab.kind === "query" && !(await saveQueryTabFile(tab.id))) return;
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
            {dirty.length} ungespeicherte Dateien der aktiven Verbindung · {transactions.length}{" "}
            offene Transaktionen · {activeTasks.length} laufende Aufgaben
          </p>
          <p className="text-muted-foreground">
            Prüfen Sie auch Dateientwürfe anderer Verbindungen. Beim Schließen gehen offene
            Transaktionen und laufende Ergebnisse möglicherweise verloren.
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
          <Button
            variant="destructive"
            disabled={saving}
            onClick={() => {
              allowClose.current = true;
              void getCurrentWindow()
                .close()
                .catch((error) => {
                  allowClose.current = false;
                  toast.error(String(error));
                });
            }}
          >
            Trotzdem schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
