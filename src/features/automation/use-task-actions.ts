import { save } from "@tauri-apps/plugin-dialog";
import { useCallback } from "react";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import {
  automationCliCommand,
  duplicateAutomationTask,
  exportAutomationTasks,
  setAutomationTasksEnabled,
  type TaskSummary,
} from "@/lib/db/automation";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exportName(ids: string[], tasks: TaskSummary[]): string {
  if (ids.length === 1) {
    const name = tasks.find((task) => task.task.id === ids[0])?.task.name ?? "task";
    return `${name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "task"}.l8db-tasks.json`;
  }
  return "l8db-tasks.json";
}

export function useTaskActions() {
  const requestRun = useAutomationStore((state) => state.requestRun);
  const upsertTask = useAutomationStore((state) => state.upsertTask);
  const select = useAutomationStore((state) => state.select);
  const confirmDelete = useAutomationStore((state) => state.confirmDelete);

  const run = useCallback(
    async (summary: TaskSummary) => {
      try {
        const runId = await requestRun(summary);
        if (runId) toast.success(`„${summary.task.name}“ gestartet`);
      } catch (error) {
        toast.error(message(error));
      }
    },
    [requestRun],
  );

  const duplicate = useCallback(
    async (summary: TaskSummary) => {
      try {
        const copy = await duplicateAutomationTask(summary.task.id);
        upsertTask(copy);
        select(copy.task.id);
        toast.success(`„${copy.task.name}“ angelegt`, {
          description: "Kopien starten deaktiviert.",
        });
      } catch (error) {
        toast.error(message(error));
      }
    },
    [upsertTask, select],
  );

  const copyCommand = useCallback(async (summary: TaskSummary) => {
    try {
      const command = await automationCliCommand(summary.task.id);
      await navigator.clipboard.writeText(command);
      toast.success("Befehl kopiert", { description: command });
    } catch (error) {
      toast.error(message(error));
    }
  }, []);

  const exportTasks = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const path = await save({
        defaultPath: exportName(ids, useAutomationStore.getState().tasks),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const count = await exportAutomationTasks(ids, path);
      toast.success(count === 1 ? "1 Task exportiert" : `${count} Tasks exportiert`, {
        description: path,
      });
    } catch (error) {
      toast.error(message(error));
    }
  }, []);

  const setEnabled = useCallback(
    async (ids: string[], enabled: boolean) => {
      try {
        const updated = await setAutomationTasksEnabled(ids, enabled);
        for (const summary of updated) upsertTask(summary);
      } catch (error) {
        toast.error(message(error));
      }
    },
    [upsertTask],
  );

  const remove = useCallback((ids: string[]) => confirmDelete(ids), [confirmDelete]);

  return { run, duplicate, copyCommand, exportTasks, setEnabled, remove };
}
