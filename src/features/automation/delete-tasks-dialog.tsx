import { useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { taskSecretAccounts } from "@/lib/automation/secrets";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import { deleteSecret } from "@/lib/db";
import { deleteAutomationTasks } from "@/lib/db/automation";

export function DeleteTasksDialog() {
  const ids = useAutomationStore((state) => state.deleteIds);
  const tasks = useAutomationStore((state) => state.tasks);
  const confirmDelete = useAutomationStore((state) => state.confirmDelete);
  const removeTasks = useAutomationStore((state) => state.removeTasks);
  const [busy, setBusy] = useState(false);
  const targets = tasks.filter((task) => ids?.includes(task.task.id));
  const single = targets.length === 1 ? targets[0] : null;
  const running = targets.filter((task) => task.runningRunId).length;

  const remove = async () => {
    if (!ids) return;
    setBusy(true);
    try {
      await deleteAutomationTasks(ids);
      await Promise.all(
        targets.flatMap((task) =>
          taskSecretAccounts(task.task).map((account) =>
            deleteSecret(account).catch(() => undefined),
          ),
        ),
      );
      removeTasks(ids);
      confirmDelete(null);
      toast.success(single ? `„${single.task.name}“ gelöscht` : `${ids.length} Tasks gelöscht`, {
        description: "Bisherige Läufe bleiben im Verlauf.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={Boolean(ids)} onOpenChange={(open) => !open && !busy && confirmDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {single ? `„${single.task.name}“ löschen?` : `${targets.length} Tasks löschen?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Zeitpläne, Alarmzustände und gespeicherte geheime Variablen werden entfernt. Bisherige
            Läufe bleiben im Verlauf.
            {running > 0 &&
              ` ${running === 1 ? "Ein Lauf ist" : `${running} Läufe sind`} gerade aktiv und läuft zu Ende.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {busy && <Spinner className="size-3.5" />}
            {single ? "Task löschen" : "Tasks löschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
