import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newTask } from "@/lib/automation/defaults";
import { dropDraft, peekDraft, stashDraft } from "@/lib/automation/editor-drafts";
import { staleSecretAccounts } from "@/lib/automation/secrets";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import { validateTask } from "@/lib/automation/validation";
import { deleteSecret } from "@/lib/db";
import {
  getAutomationTask,
  saveAutomationTask,
  type Task,
  type TaskSummary,
  type ValidationIssue,
  validateAutomationTask,
} from "@/lib/db/automation";

interface Options {
  taskId: string | null;
  draft?: Task;
  onSaved: (summary: TaskSummary) => void;
}

function mergeIssues(client: ValidationIssue[], server: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set(client.map((issue) => `${issue.stepId}|${issue.field}|${issue.severity}`));
  return [
    ...client,
    ...server.filter((issue) => !seen.has(`${issue.stepId}|${issue.field}|${issue.severity}`)),
  ];
}

export function useTaskDraft({ taskId, draft, onSaved }: Options) {
  const stored = useAutomationStore((state) =>
    taskId ? state.tasks.find((entry) => entry.task.id === taskId) : undefined,
  );
  const [initial] = useState(() => {
    const restored = taskId ? peekDraft(taskId) : null;
    const base = taskId ? (stored?.task ?? null) : (draft ?? newTask());
    return {
      task: restored?.task ?? base,
      baseline: base && taskId ? JSON.stringify(base) : null,
      revision: taskId ? (restored?.revision ?? base?.revision ?? null) : null,
      restored: Boolean(restored),
    };
  });
  const [task, setTask] = useState<Task | null>(initial.task);
  const [baseline, setBaseline] = useState<string | null>(initial.baseline);
  const [revision, setRevision] = useState<number | null>(initial.revision);
  const [restored, setRestored] = useState(initial.restored);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverIssues, setServerIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    if (!taskId || task) return;
    let alive = true;
    getAutomationTask(taskId)
      .then((loaded) => {
        if (!alive) return;
        setTask(loaded);
        setBaseline(JSON.stringify(loaded));
        setRevision(loaded.revision);
      })
      .catch((error) => alive && setLoadError(String(error)));
    return () => {
      alive = false;
    };
  }, [taskId, task]);

  const isNew = revision === null;
  const json = useMemo(() => (task ? JSON.stringify(task) : null), [task]);
  const dirty = json !== null && json !== baseline;
  const clientIssues = useMemo(() => (task ? validateTask(task) : []), [task]);

  useEffect(() => {
    if (!json) return;
    let alive = true;
    const timer = setTimeout(() => {
      validateAutomationTask(JSON.parse(json) as Task)
        .then((issues) => alive && setServerIssues(issues))
        .catch(() => alive && setServerIssues([]));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [json]);

  const issues = useMemo(
    () => mergeIssues(clientIssues, serverIssues),
    [clientIssues, serverIssues],
  );
  const errors = issues.filter((issue) => issue.severity === "error");

  useEffect(() => {
    if (!stored || dirty || revision === null || stored.task.revision <= revision) return;
    setTask(stored.task);
    setBaseline(JSON.stringify(stored.task));
    setRevision(stored.task.revision);
  }, [stored, dirty, revision]);

  const name = task?.name;
  useEffect(() => {
    if (taskId || name === undefined) return;
    useAutomationStore.getState().renameDraft(name);
  }, [taskId, name]);

  const latest = useRef({ task, dirty, revision, isNew });
  latest.current = { task, dirty, revision, isNew };

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current) return;

        const { task: current, dirty: changed, revision: rev, isNew: fresh } = latest.current;
        if (!current) return;
        if (!changed) {
          dropDraft(current.id);
          return;
        }
        stashDraft(current, rev);
        const store = useAutomationStore.getState();
        toast(`„${current.name || "Neuer Task"}“ ist nicht gespeichert`, {
          description: "Deine Änderungen sind noch da.",
          action: {
            label: "Zurück",
            onClick: () => {
              if (fresh) {
                dropDraft(current.id);
                store.openDraft(current);
              } else {
                store.select(current.id);
              }
            },
          },
        });
      }, 0);
    };
  }, []);

  const patch = useCallback(
    (change: Partial<Task>) =>
      setTask((current) => (current ? { ...current, ...change } : current)),
    [],
  );

  const save = useCallback(async (): Promise<TaskSummary | null> => {
    const current = latest.current.task;
    if (!current) return null;
    const blocked = current.enabled && errors.length > 0;
    const payload = blocked ? { ...current, enabled: false } : current;
    setSaving(true);
    try {
      const summary = await saveAutomationTask(payload, latest.current.revision);
      if (baseline)
        for (const account of staleSecretAccounts(JSON.parse(baseline) as Task, summary.task))
          deleteSecret(account).catch(() => undefined);
      setBaseline(JSON.stringify(summary.task));
      setRevision(summary.task.revision);
      setTask((now) => (now === current ? summary.task : now));
      setRestored(false);
      dropDraft(summary.task.id);
      latest.current = {
        task: summary.task,
        dirty: false,
        revision: summary.task.revision,
        isNew: false,
      };
      if (blocked)
        toast.warning("Gespeichert, aber pausiert", {
          description: "Der Task hat noch Fehler und wird erst nach dem Beheben aktiv.",
        });
      onSaved(summary);
      return summary;
    } catch (error) {
      toast.error("Speichern fehlgeschlagen", { description: String(error) });
      return null;
    } finally {
      setSaving(false);
    }
  }, [baseline, errors.length, onSaved]);

  const discard = useCallback(() => {
    if (!baseline) return;
    const original = JSON.parse(baseline) as Task;
    dropDraft(original.id);
    setTask(original);
    setRestored(false);
  }, [baseline]);

  return {
    task,
    stored,
    setTask,
    patch,
    issues,
    errors,
    dirty,
    isNew,
    saving,
    save,
    discard,
    restored,
    loadError,
  };
}
