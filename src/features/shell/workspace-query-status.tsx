import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/shallow";
import { useActiveConnection } from "@/lib/connections";
import { formatIslandDuration, ISLAND_TASK_DELAY } from "@/lib/dynamic-island";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cancelTask, isQueryTask, isTaskActive, useTasksStore } from "@/lib/tasks";
import {
  formatQueryElapsed,
  showWorkspaceMessage,
  useWorkspaceStatusStore,
} from "@/lib/workspace-status";

export function WorkspaceQueryStatus() {
  const connection = useActiveConnection();
  const feature = useNewFeatureVisibility<HTMLDivElement>("workspace.status.query");
  const message = useWorkspaceStatusStore((state) => state.message);
  const queries = useTasksStore(
    useShallow((state) => state.tasks.filter((task) => isQueryTask(task) && isTaskActive(task))),
  );
  const task = queries.find((entry) => entry.connectionId === connection?.id) ?? queries[0];
  const taskId = task?.id;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!taskId) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [taskId]);

  useEffect(
    () =>
      useTasksStore.subscribe((state, previous) => {
        const active = new Set(previous.tasks.filter(isTaskActive).map((entry) => entry.id));
        const finished = state.tasks.find(
          (entry) => isQueryTask(entry) && active.has(entry.id) && !isTaskActive(entry),
        );
        if (!finished || finished.status === "interrupted") return;
        const elapsed = (finished.finishedAt ?? Date.now()) - finished.startedAt;
        if (elapsed < ISLAND_TASK_DELAY) return;
        const outcome =
          finished.status === "success"
            ? "abgeschlossen"
            : finished.status === "error"
              ? "fehlgeschlagen"
              : "abgebrochen";
        showWorkspaceMessage(
          `${finished.title} ${outcome} · ${formatIslandDuration(elapsed)}`,
          finished.status === "error"
            ? "error"
            : finished.status === "success"
              ? "success"
              : "neutral",
        );
      }),
    [],
  );

  if (!task && !message) return null;

  return (
    <div
      ref={feature.ref}
      className="flex min-w-0 shrink-0 items-center gap-3"
      data-workspace-activity
    >
      {message && (
        <span role="status" className="flex min-w-0 items-center gap-1.5" title={message.title}>
          {message.tone === "error" ? (
            <XIcon className="size-3 shrink-0 text-destructive" />
          ) : message.tone === "success" ? (
            <CheckIcon className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : null}
          <span
            className={`max-w-48 truncate text-foreground ${task ? "@max-[720px]/footer:sr-only" : ""}`}
          >
            {message.title}
          </span>
        </span>
      )}
      {task && (
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <LoaderCircleIcon className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
            <span role="status" className="truncate" title={task.connectionName}>
              {task.status === "cancelling" ? "Wird abgebrochen…" : `${task.title} läuft`}
              {task.connectionId !== connection?.id && task.connectionName
                ? ` · ${task.connectionName}`
                : ""}
            </span>
            <span className="shrink-0 font-mono tabular-nums" title="Laufzeit">
              {formatQueryElapsed(task.startedAt, now)}
            </span>
          </span>
          {task.cancellable && (
            <button
              type="button"
              disabled={task.status === "cancelling"}
              className="shrink-0 rounded px-1 text-primary hover:underline focus-visible:outline-2 disabled:text-muted-foreground disabled:no-underline"
              onClick={() => void cancelTask(task.id).catch((error) => toast.error(String(error)))}
            >
              Abbrechen
            </button>
          )}
          {queries.length > 1 && (
            <button
              type="button"
              className="shrink-0 rounded px-1 hover:text-foreground focus-visible:outline-2"
              onClick={() => useTasksStore.setState({ open: true })}
              aria-label={`${queries.length} laufende SQL-Abfragen anzeigen`}
            >
              +{queries.length - 1}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
