import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export type EditorAiAction =
  | "inline"
  | "edit"
  | "fix"
  | "optimize"
  | "comment"
  | "cte"
  | "dialect"
  | "testdata"
  | "summary";

export const EDITOR_AI_ACTION_LABELS: Record<EditorAiAction, string> = {
  inline: "Ghost-Text",
  edit: "Inline bearbeiten",
  fix: "Fehler beheben",
  optimize: "Optimieren",
  comment: "Kommentieren",
  cte: "In CTE umwandeln",
  dialect: "Dialekt übersetzen",
  testdata: "Testdaten",
  summary: "Verlauf zusammenfassen",
};

export interface EditorAiStats {
  requests: number;
  errors: number;
  cancelled: number;
  input: number;
  output: number;
  cached: number;
  written: number;
  cost: number;
  latencyMs: number;
  latencies: number[];
  accepted: number;
  rejected: number;
  partial: number;
  retries: number;
  cacheHits: number;
}

export interface EditorAiRequestSample {
  input: number;
  output: number;
  cached: number;
  written: number;
  cost: number | null;
  latencyMs: number;
}

const EMPTY: EditorAiStats = {
  requests: 0,
  errors: 0,
  cancelled: 0,
  input: 0,
  output: 0,
  cached: 0,
  written: 0,
  cost: 0,
  latencyMs: 0,
  latencies: [],
  accepted: 0,
  rejected: 0,
  partial: 0,
  retries: 0,
  cacheHits: 0,
};

const MAX_LATENCIES = 50;

interface MetricsState {
  since: number;
  actions: Partial<Record<EditorAiAction, EditorAiStats>>;
  record: (action: EditorAiAction, sample: EditorAiRequestSample) => void;
  fail: (action: EditorAiAction, cancelled: boolean) => void;
  outcome: (action: EditorAiAction, outcome: "accepted" | "rejected" | "partial") => void;
  retry: (action: EditorAiAction) => void;
  localHit: (action: EditorAiAction) => void;
  reset: () => void;
}

function change(
  actions: MetricsState["actions"],
  action: EditorAiAction,
  patch: (stats: EditorAiStats) => Partial<EditorAiStats>,
): MetricsState["actions"] {
  const current = actions[action] ?? EMPTY;
  return { ...actions, [action]: { ...current, ...patch(current) } };
}

const WRITE_DELAY_MS = 2_000;
let pendingWrite: { name: string; value: string } | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

export function flushEditorAiMetrics() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (!pendingWrite) return;
  const { name, value } = pendingWrite;
  pendingWrite = null;
  try {
    globalThis.localStorage?.setItem(name, value);
  } catch {}
}

const debouncedStorage: StateStorage = {
  getItem: (name) => globalThis.localStorage?.getItem(name) ?? null,
  setItem: (name, value) => {
    pendingWrite = { name, value };
    if (!writeTimer) writeTimer = setTimeout(flushEditorAiMetrics, WRITE_DELAY_MS);
  },
  removeItem: (name) => globalThis.localStorage?.removeItem(name),
};

globalThis.addEventListener?.("pagehide", flushEditorAiMetrics);

export const useEditorAiMetrics = create<MetricsState>()(
  persist(
    (set) => ({
      since: Date.now(),
      actions: {},
      record: (action, sample) =>
        set((state) => ({
          actions: change(state.actions, action, (stats) => ({
            requests: stats.requests + 1,
            input: stats.input + sample.input,
            output: stats.output + sample.output,
            cached: stats.cached + sample.cached,
            written: stats.written + sample.written,
            cost: stats.cost + (sample.cost ?? 0),
            latencyMs: stats.latencyMs + sample.latencyMs,
            latencies: [...stats.latencies, Math.round(sample.latencyMs)].slice(-MAX_LATENCIES),
          })),
        })),
      fail: (action, cancelled) =>
        set((state) => ({
          actions: change(state.actions, action, (stats) =>
            cancelled ? { cancelled: stats.cancelled + 1 } : { errors: stats.errors + 1 },
          ),
        })),
      outcome: (action, outcome) =>
        set((state) => ({
          actions: change(state.actions, action, (stats) => ({ [outcome]: stats[outcome] + 1 })),
        })),
      retry: (action) =>
        set((state) => ({
          actions: change(state.actions, action, (stats) => ({ retries: stats.retries + 1 })),
        })),
      localHit: (action) =>
        set((state) => ({
          actions: change(state.actions, action, (stats) => ({ cacheHits: stats.cacheHits + 1 })),
        })),
      reset: () => set({ since: Date.now(), actions: {} }),
    }),
    {
      name: "l8db.ai.editor.metrics",
      version: 1,
      storage: createJSONStorage(() => debouncedStorage),
    },
  ),
);

syncAcrossWindows("l8db.ai.editor.metrics", () => void useEditorAiMetrics.persist.rehydrate());

export function percentile(values: readonly number[], share: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

export function summarizeEditorAiStats(stats: EditorAiStats) {
  const decided = stats.accepted + stats.rejected + stats.partial;
  return {
    tokensPerRequest: stats.requests
      ? Math.round((stats.input + stats.output) / stats.requests)
      : 0,
    cacheRate: stats.input ? stats.cached / stats.input : 0,
    acceptRate: decided ? (stats.accepted + stats.partial / 2) / decided : null,
    medianMs: percentile(stats.latencies, 0.5),
    p95Ms: percentile(stats.latencies, 0.95),
  };
}
