import { type AutomationEvent, cancelAutomationRun, onAutomationEvent } from "@/lib/db/automation";
import { finishTask, isTaskActive, startTask, updateTask, useTasksStore } from "@/lib/tasks";

export function automationTaskId(runId: string): string {
  return `automation:${runId}`;
}

const finishedSteps = new Map<string, Set<string>>();

function isActive(id: string): boolean {
  return useTasksStore.getState().tasks.some((task) => task.id === id && isTaskActive(task));
}

export function bridgeAutomationEvent(event: AutomationEvent): void {
  switch (event.event) {
    case "run_started": {
      const { run } = event;
      const id = automationTaskId(run.id);
      if (isActive(id)) return;
      finishedSteps.set(run.id, new Set());
      startTask({ id, title: `Automatisierung · ${run.taskName}`, total: run.stepsTotal }, () =>
        cancelAutomationRun(run.id),
      );
      return;
    }
    case "run_step": {
      const id = automationTaskId(event.runId);
      if (!isActive(id)) return;
      const { step } = event;
      const patch: { detail: string; progress?: number } = {
        detail: `Schritt ${step.seq}: ${step.stepName}`,
      };
      if (step.depth === 0 && step.status !== "running") {
        const done = finishedSteps.get(event.runId) ?? new Set<string>();
        done.add(step.stepId);
        finishedSteps.set(event.runId, done);
        patch.progress = done.size;
      }
      updateTask(id, patch);
      return;
    }
    case "run_finished": {
      const { run } = event;
      const id = automationTaskId(run.id);
      finishedSteps.delete(run.id);
      if (!isActive(id)) return;
      updateTask(id, { progress: run.stepsDone, total: run.stepsTotal });
      if (run.status === "cancelled") {
        finishTask(id, undefined, new Error("Vom Benutzer abgebrochen."));
        return;
      }
      if (run.status === "failed" || run.status === "timeout" || run.status === "interrupted") {
        finishTask(id, { rows: [] }, new Error(run.error ?? "Fehlgeschlagen"));
        return;
      }
      finishTask(id, { rows: [] });
      return;
    }
    default:
      return;
  }
}

let bridged: Promise<() => void> | null = null;

export function initAutomationTaskBridge(): Promise<() => void> {
  bridged ??= onAutomationEvent(bridgeAutomationEvent).catch((error) => {
    bridged = null;
    throw error;
  });
  return bridged;
}
