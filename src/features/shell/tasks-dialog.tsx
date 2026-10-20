import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHasNewFeatures } from "@/lib/new-features";
import {
  type AppTask,
  cancelTask,
  clearFinishedTasks,
  isTaskActive,
  useTasksStore,
} from "@/lib/tasks";
import { SqlLogPanel } from "./sql-log-panel";

const NO_TASKS: AppTask[] = [];

const STATUS_LABELS = {
  running: "Läuft",
  cancelling: "Abbruch angefordert",
  success: "Abgeschlossen",
  error: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
  interrupted: "Unterbrochen",
};

export function TasksDialog() {
  const open = useTasksStore((state) => state.open);
  const live = useTasksStore((state) => (state.open ? state.tasks : null));
  const shown = useRef(NO_TASKS);
  if (live) shown.current = live;
  const tasks = live ?? shown.current;
  const [now, setNow] = useState(Date.now());
  const sqlLogNew = useHasNewFeatures("tasks.sql-log");
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => useTasksStore.setState({ open: value })}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Aufgaben</DialogTitle>
          <DialogDescription>
            Laufende Vorgänge und die letzten 100 Ergebnisse. Ergebnisvorschauen bleiben während
            dieser App-Sitzung verfügbar.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="tasks" className="min-h-0">
          <TabsList className="w-fit">
            <TabsTrigger value="tasks" className="text-xs">
              Aufgaben
            </TabsTrigger>
            <TabsTrigger value="sql-log" className="gap-1.5 text-xs">
              SQL-Protokoll
              {sqlLogNew && <NewBadge />}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="sql-log">
            <SqlLogPanel />
          </TabsContent>
          <TabsContent value="tasks" className="space-y-3">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={clearFinishedTasks}>
                Abgeschlossene entfernen
              </Button>
            </div>
            <div className="max-h-[65vh] space-y-3 overflow-auto" aria-live="polite">
              {tasks.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Noch keine Aufgaben.
                </p>
              )}
              {open &&
                tasks.map((task) => (
                  <article key={task.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.connectionName} {task.database ? `· ${task.database}` : ""}
                        </p>
                      </div>
                      <span className="text-xs">
                        {STATUS_LABELS[task.status]} ·{" "}
                        {Math.max(
                          0,
                          Math.floor(((task.finishedAt ?? now) - task.startedAt) / 1000),
                        )}{" "}
                        s
                      </span>
                    </div>
                    {task.progress !== undefined && (
                      <p className="text-xs tabular-nums">
                        {task.progress}
                        {task.total !== undefined ? ` / ${task.total}` : ""}
                      </p>
                    )}
                    {task.detail && <p className="text-xs text-muted-foreground">{task.detail}</p>}
                    {task.error && (
                      <p
                        role="alert"
                        className="whitespace-pre-wrap break-words text-xs text-destructive"
                      >
                        {task.error}
                      </p>
                    )}
                    {task.cancellable && isTaskActive(task) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={task.status === "cancelling"}
                        onClick={() =>
                          void cancelTask(task.id).catch((error) => toast.error(String(error)))
                        }
                      >
                        Abbrechen
                      </Button>
                    )}
                    {task.result !== undefined && (
                      <details>
                        <summary className="cursor-pointer text-xs">Ergebnis anzeigen</summary>
                        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs">
                          {JSON.stringify(task.result, null, 2)}
                        </pre>
                      </details>
                    )}
                  </article>
                ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
