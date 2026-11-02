import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
  type StorageValue,
} from "zustand/middleware";

export type TaskStatus =
  | "running"
  | "cancelling"
  | "success"
  | "error"
  | "cancelled"
  | "interrupted";

export interface AppTask {
  id: string;
  title: string;
  connectionId?: string;
  connectionName?: string;
  database?: string | null;
  startedAt: number;
  finishedAt?: number;
  status: TaskStatus;
  progress?: number;
  total?: number;
  detail?: string;
  error?: string;
  result?: unknown;
  cancellable: boolean;
}

interface TasksState {
  tasks: AppTask[];
  open: boolean;
}

export function isTaskActive(task: Pick<AppTask, "status">) {
  return task.status === "running" || task.status === "cancelling";
}

export function isQueryTask(task: Pick<AppTask, "title">): boolean {
  return task.title === "SQL-Abfrage" || task.title === "SQL-Skript";
}

const PERSISTED_TEXT_LIMIT = 2000;

function clip(text: string | undefined) {
  return text && text.length > PERSISTED_TEXT_LIMIT
    ? `${text.slice(0, PERSISTED_TEXT_LIMIT)}…`
    : text;
}

const quotaSafeStorage: StateStorage = {
  getItem: (name) => window.localStorage.getItem(name),
  removeItem: (name) => window.localStorage.removeItem(name),
  setItem: (name, value) => {
    let payload = value;
    let parsed: StorageValue<{ tasks: AppTask[] }> | undefined;
    for (;;) {
      try {
        window.localStorage.setItem(name, payload);
        return;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "QuotaExceededError")) {
          console.warn("Aufgabenverlauf konnte nicht gespeichert werden.", error);
          return;
        }
        parsed ??= JSON.parse(payload) as StorageValue<{ tasks: AppTask[] }>;
        const tasks = parsed.state.tasks;
        if (tasks.length === 0) {
          window.localStorage.removeItem(name);
          console.warn("Aufgabenverlauf konnte nicht gespeichert werden.", error);
          return;
        }
        parsed = {
          ...parsed,
          state: { ...parsed.state, tasks: tasks.slice(0, Math.floor(tasks.length / 2)) },
        };
        payload = JSON.stringify(parsed);
      }
    }
  },
};

export const useTasksStore = create<TasksState>()(
  persist((): TasksState => ({ tasks: [], open: false }), {
    name: "l8db.tasks",
    storage: createJSONStorage(() => quotaSafeStorage),
    partialize: (state) => ({
      tasks: state.tasks.map(({ result: _result, ...task }) => ({
        ...task,
        detail: clip(task.detail),
        error: clip(task.error),
      })),
    }),
    merge: (saved, current) => ({
      ...current,
      tasks: ((saved as Partial<TasksState>)?.tasks ?? []).map((task) =>
        isTaskActive(task)
          ? {
              ...task,
              status: "interrupted" as const,
              cancellable: false,
              detail: "App wurde beendet. Serverzustand vor erneutem Ausführen prüfen.",
            }
          : { ...task, cancellable: false },
      ),
    }),
  }),
);

const cancellations = new Map<string, () => Promise<boolean | void>>();

export function startTask(
  input: Pick<AppTask, "title" | "connectionId" | "connectionName" | "database"> & {
    id?: string;
    total?: number;
  },
  cancel?: () => Promise<boolean | void>,
): string {
  const id = input.id ?? crypto.randomUUID();
  if (useTasksStore.getState().tasks.some((task) => task.id === id && isTaskActive(task))) {
    throw new Error("Aufgabe läuft bereits.");
  }
  if (cancel) cancellations.set(id, cancel);
  useTasksStore.setState((state) => ({
    tasks: [
      { ...input, id, startedAt: Date.now(), status: "running", cancellable: Boolean(cancel) },
      ...state.tasks.filter((task) => task.id !== id && isTaskActive(task)),
      ...state.tasks.filter((task) => task.id !== id && !isTaskActive(task)).slice(0, 99),
    ],
  }));
  return id;
}

export function updateTask(id: string, patch: Partial<AppTask>) {
  useTasksStore.setState((state) => ({
    tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch, id } : task)),
  }));
}

export function finishTask(id: string, result?: unknown, error?: unknown) {
  cancellations.delete(id);
  const message =
    error == null ? undefined : error instanceof Error ? error.message : String(error);
  const cancelled = Boolean(
    message &&
      /vom Server abgebrochen|bevor sie gestartet|vom Benutzer abgebrochen|zwischen den Statements abgebrochen/i.test(
        message,
      ),
  );
  const preview =
    result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
      ? {
          ...result,
          rows: result.rows.slice(0, 20),
          preview: result.rows.length > 20 ? `20 von ${result.rows.length} Zeilen` : undefined,
        }
      : typeof result === "string"
        ? result.slice(0, 20000)
        : result;
  updateTask(id, {
    status: message ? (cancelled ? "cancelled" : "error") : "success",
    finishedAt: Date.now(),
    cancellable: false,
    error: message,
    result: preview,
  });
}

export async function cancelTask(id: string) {
  const cancel = cancellations.get(id);
  if (!cancel || !useTasksStore.getState().tasks.find((task) => task.id === id)?.cancellable)
    return;
  updateTask(id, {
    status: "cancelling",
    detail: "Abbruch angefordert; Serverabschluss wird abgewartet.",
  });
  try {
    const accepted = await cancel();
    const task = useTasksStore.getState().tasks.find((entry) => entry.id === id);
    if (accepted === false && task && isTaskActive(task))
      updateTask(id, {
        status: "running",
        detail:
          "Aufgabe ist noch nicht gestartet oder bereits abgeschlossen. Bei Bedarf erneut abbrechen.",
      });
  } catch (error) {
    const task = useTasksStore.getState().tasks.find((entry) => entry.id === id);
    if (task && isTaskActive(task)) updateTask(id, { status: "running", detail: String(error) });
    throw error;
  }
}

export function clearFinishedTasks() {
  useTasksStore.setState((state) => ({ tasks: state.tasks.filter(isTaskActive) }));
}
