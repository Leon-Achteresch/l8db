import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/backup";
import { useBackupJobs } from "@/lib/backup-runner";
import { cancelTask, isTaskActive, useTasksStore } from "@/lib/tasks";

interface BackupJobLogProps {
  jobId: string;
}

const EMPTY: string[] = [];

export function BackupJobLog({ jobId }: BackupJobLogProps) {
  const lines = useBackupJobs((state) => state.logs[jobId] ?? EMPTY);
  const progress = useBackupJobs((state) => state.progress[jobId] ?? null);
  const outcome = useBackupJobs((state) => state.outcomes[jobId]);
  const task = useTasksStore((state) => state.tasks.find((entry) => entry.id === jobId));
  const logRef = useRef<HTMLPreElement>(null);
  const active = Boolean(task && isTaskActive(task));

  useEffect(() => {
    const element = logRef.current;
    if (element && lines.length) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <section className="grid gap-2 rounded-md border p-3" aria-label="Protokoll">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">
          {active
            ? task?.status === "cancelling"
              ? "Abbruch angefordert…"
              : "Läuft…"
            : task?.status === "success"
              ? "Abgeschlossen"
              : task?.status === "cancelled"
                ? "Abgebrochen"
                : task?.status === "error"
                  ? "Fehlgeschlagen"
                  : "Protokoll"}
        </span>
        {task?.cancellable && active && (
          <Button
            variant="outline"
            size="xs"
            disabled={task.status === "cancelling"}
            onClick={() => void cancelTask(jobId).catch((error) => toast.error(String(error)))}
          >
            Abbrechen
          </Button>
        )}
      </div>
      {active && progress !== null && <Progress value={progress} />}
      {outcome && (
        <p className="text-xs text-muted-foreground">
          {outcome.path && <span className="font-mono">{outcome.path}</span>}
          {outcome.bytes != null && ` · ${formatBytes(outcome.bytes)}`} ·{" "}
          {(outcome.durationMs / 1000).toFixed(1)} s
        </p>
      )}
      {task?.error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">
          {task.error}
        </p>
      )}
      <pre
        ref={logRef}
        className="max-h-72 min-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[11px]"
      >
        {lines.length ? lines.join("\n") : "Noch keine Ausgabe."}
      </pre>
    </section>
  );
}
