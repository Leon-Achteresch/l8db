import { create } from "zustand";
import {
  type AutomationEvent,
  type LogLine,
  listAutomationRuns,
  listAutomationTasks,
  onAutomationEvent,
  type RunFilter,
  type RunSummary,
  type RunTaskInput,
  runAutomationTask,
  type StepRun,
  type Task,
  type TaskSummary,
} from "@/lib/db/automation";
import { type AutomationViewId, useAutomationUiState } from "./ui-state";

export type TaskStatusFilter = "all" | "enabled" | "disabled" | "failing" | "running" | "review";

export interface ActiveRun {
  summary: RunSummary;
  steps: StepRun[];
  logs: LogLine[];
}

interface AutomationState {
  tasks: TaskSummary[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  draft: Task | null;
  draftKey: number;
  view: AutomationViewId;
  search: string;
  folderFilter: string | null;
  tagFilter: string | null;
  statusFilter: TaskStatusFilter;
  selection: string[];
  runs: RunSummary[];
  runsLoaded: boolean;
  runFilter: RunFilter;
  selectedRunId: string | null;
  activeRuns: Record<string, ActiveRun>;
  runPrompt: TaskSummary | null;
  deleteIds: string[] | null;
  load: () => Promise<void>;
  loadRuns: (filter?: RunFilter) => Promise<void>;
  applyEvent: (event: AutomationEvent) => void;
  select: (id: string | null) => void;
  openDraft: (task: Task) => void;
  renameDraft: (name: string) => void;
  setView: (view: AutomationViewId) => void;
  setSearch: (search: string) => void;
  setFolderFilter: (folder: string | null) => void;
  setTagFilter: (tag: string | null) => void;
  setStatusFilter: (filter: TaskStatusFilter) => void;
  setSelection: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  selectRun: (id: string | null) => void;
  upsertTask: (summary: TaskSummary) => void;
  removeTasks: (ids: string[]) => void;
  requestRun: (summary: TaskSummary) => Promise<string | null>;
  closeRunPrompt: () => void;
  confirmDelete: (ids: string[] | null) => void;
  startRun: (input: RunTaskInput) => Promise<string>;
}

export function needsRunPrompt(task: Task): boolean {
  return task.variables.some((variable) => variable.prompt) || task.environments.length > 1;
}

const MAX_RUNS = 200;
const MAX_LOGS = 2000;

function upsertRun(runs: RunSummary[], run: RunSummary): RunSummary[] {
  const index = runs.findIndex((entry) => entry.id === run.id);
  if (index < 0) return [run, ...runs].slice(0, MAX_RUNS);
  const next = runs.slice();
  next[index] = run;
  return next;
}

function upsertStep(steps: StepRun[], step: StepRun): StepRun[] {
  const index = steps.findIndex((entry) => entry.seq === step.seq);
  if (index < 0) return [...steps, step].sort((a, b) => a.seq - b.seq);
  const next = steps.slice();
  next[index] = step;
  return next;
}

function completedTopLevel(steps: StepRun[]): number {
  const done = new Set<string>();
  for (const step of steps)
    if (step.depth === 0 && step.status !== "running") done.add(step.stepId);
  return done.size;
}

function patchTask(
  tasks: TaskSummary[],
  taskId: string,
  patch: (task: TaskSummary) => TaskSummary,
): TaskSummary[] {
  let changed = false;
  const next = tasks.map((task) => {
    if (task.task.id !== taskId) return task;
    changed = true;
    return patch(task);
  });
  return changed ? next : tasks;
}

function initialView(): AutomationViewId {
  try {
    return useAutomationUiState.getState().lastView ?? "tasks";
  } catch {
    return "tasks";
  }
}

export const useAutomationStore = create<AutomationState>()((set, get) => ({
  tasks: [],
  loaded: false,
  loading: false,
  error: null,
  selectedId: null,
  draft: null,
  draftKey: 0,
  view: initialView(),
  search: "",
  folderFilter: null,
  tagFilter: null,
  statusFilter: "all",
  selection: [],
  runs: [],
  runsLoaded: false,
  runFilter: { limit: MAX_RUNS },
  selectedRunId: null,
  activeRuns: {},
  runPrompt: null,
  deleteIds: null,
  load: async () => {
    set({ loading: true });
    try {
      const tasks = await listAutomationTasks();
      const ids = new Set(tasks.map((task) => task.task.id));
      set((state) => ({
        tasks,
        loaded: true,
        loading: false,
        error: null,
        selection: state.selection.filter((id) => ids.has(id)),
        selectedId: state.selectedId && ids.has(state.selectedId) ? state.selectedId : null,
      }));
    } catch (error) {
      set({ loaded: true, loading: false, error: String(error) });
    }
  },
  loadRuns: async (filter) => {
    const runFilter = filter ?? get().runFilter;
    set({ runFilter });
    try {
      const runs = await listAutomationRuns({ ...runFilter, limit: runFilter.limit ?? MAX_RUNS });
      set({ runs, runsLoaded: true });
    } catch (error) {
      set({ runsLoaded: true, error: String(error) });
    }
  },
  applyEvent: (event) =>
    set((state) => {
      switch (event.event) {
        case "run_started": {
          const { run } = event;
          return {
            activeRuns: {
              ...state.activeRuns,
              [run.id]: { summary: run, steps: [], logs: [] },
            },
            runs: upsertRun(state.runs, run),
            tasks: patchTask(state.tasks, run.taskId, (task) => ({
              ...task,
              runningRunId: run.id,
            })),
          };
        }
        case "run_step": {
          const active = state.activeRuns[event.runId];
          if (!active) return {};
          const steps = upsertStep(active.steps, event.step);
          const summary = { ...active.summary, stepsDone: completedTopLevel(steps) };
          return {
            activeRuns: { ...state.activeRuns, [event.runId]: { ...active, steps, summary } },
            runs: state.runs.some((run) => run.id === event.runId)
              ? upsertRun(state.runs, summary)
              : state.runs,
          };
        }
        case "run_log": {
          const active = state.activeRuns[event.runId];
          if (!active) return {};
          const logs = [...active.logs, event.line].slice(-MAX_LOGS);
          return { activeRuns: { ...state.activeRuns, [event.runId]: { ...active, logs } } };
        }
        case "run_finished": {
          const { run } = event;
          const activeRuns = { ...state.activeRuns };
          delete activeRuns[run.id];
          return {
            activeRuns,
            runs: upsertRun(state.runs, run),
            tasks: patchTask(state.tasks, run.taskId, (task) => ({
              ...task,
              runningRunId: task.runningRunId === run.id ? null : task.runningRunId,
              state: {
                ...task.state,
                lastRunAt: run.startedAt,
                lastRunId: run.id,
                lastStatus: run.status,
              },
            })),
          };
        }
        case "tasks_changed":
          return {};
        case "alert_changed": {
          const { alert } = event;
          return {
            tasks: patchTask(state.tasks, alert.taskId, (task) => ({
              ...task,
              alerts: task.alerts.some((entry) => entry.stepId === alert.stepId)
                ? task.alerts.map((entry) => (entry.stepId === alert.stepId ? alert : entry))
                : [...task.alerts, alert],
            })),
          };
        }
        default:
          return {};
      }
    }),
  select: (selectedId) => set({ selectedId, draft: null, view: "tasks" }),
  openDraft: (draft) =>
    set((state) => ({ draft, selectedId: null, view: "tasks", draftKey: state.draftKey + 1 })),
  renameDraft: (name) =>
    set((state) =>
      state.draft && state.draft.name !== name ? { draft: { ...state.draft, name } } : {},
    ),
  setView: (view) => {
    useAutomationUiState.getState().setLastView(view);
    set({ view });
  },
  setSearch: (search) => set({ search }),
  setFolderFilter: (folderFilter) => set({ folderFilter }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSelection: (selection) => set({ selection }),
  toggleSelected: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((entry) => entry !== id)
        : [...state.selection, id],
    })),
  selectRun: (selectedRunId) => set({ selectedRunId }),
  upsertTask: (summary) =>
    set((state) => {
      const exists = state.tasks.some((task) => task.task.id === summary.task.id);
      return {
        tasks: exists
          ? state.tasks.map((task) => (task.task.id === summary.task.id ? summary : task))
          : [...state.tasks, summary],
      };
    }),
  removeTasks: (ids) =>
    set((state) => ({
      tasks: state.tasks.filter((task) => !ids.includes(task.task.id)),
      selection: state.selection.filter((id) => !ids.includes(id)),
      selectedId: state.selectedId && ids.includes(state.selectedId) ? null : state.selectedId,
    })),
  requestRun: async (summary) => {
    if (needsRunPrompt(summary.task)) {
      set({ runPrompt: summary });
      return null;
    }
    return get().startRun({ taskId: summary.task.id });
  },
  closeRunPrompt: () => set({ runPrompt: null }),
  confirmDelete: (deleteIds) => set({ deleteIds: deleteIds?.length ? deleteIds : null }),
  startRun: async (input) => {
    const runId = await runAutomationTask(input);
    set((state) => ({
      runPrompt: null,
      tasks: patchTask(state.tasks, input.taskId, (task) => ({
        ...task,
        runningRunId: task.runningRunId ?? runId,
      })),
    }));
    return runId;
  },
}));

let subscribed: Promise<() => void> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    const store = useAutomationStore.getState();
    if (store.loaded) void store.load();
  }, 150);
}

export function subscribeAutomationEvents(): Promise<() => void> {
  subscribed ??= onAutomationEvent((event) => {
    useAutomationStore.getState().applyEvent(event);
    if (event.event === "tasks_changed" || event.event === "run_finished") scheduleReload();
  }).catch((error) => {
    subscribed = null;
    throw error;
  });
  return subscribed;
}
