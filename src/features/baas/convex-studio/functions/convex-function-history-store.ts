import { create } from "zustand";

const MAX_RUNS = 50;
const MAX_DEPLOYMENTS = 20;
const MAX_TEXT = 4000;

export interface ConvexFunctionRunEntry {
  id: string;
  at: number;
  identifier: string;
  componentPath: string | null;
  args: string;
  success: boolean;
  durationMs: number;
  preview: string;
}

type HistoryState = {
  runs: Record<string, ConvexFunctionRunEntry[]>;
  add: (deployment: string, entry: Omit<ConvexFunctionRunEntry, "id" | "at">) => void;
  clear: (deployment: string) => void;
  clearProfile: (profileId: string) => void;
};

export const clipText = (text: string) =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;

export const useConvexFunctionHistory = create<HistoryState>()((set) => ({
  runs: {},
  add: (deployment, entry) =>
    set((state) => {
      const item: ConvexFunctionRunEntry = {
        ...entry,
        args: clipText(entry.args),
        preview: clipText(entry.preview),
        id: crypto.randomUUID(),
        at: Date.now(),
      };
      const others = Object.entries(state.runs)
        .filter(([key]) => key !== deployment)
        .sort(([, a], [, b]) => (b[0]?.at ?? 0) - (a[0]?.at ?? 0))
        .slice(0, MAX_DEPLOYMENTS - 1);
      return {
        runs: {
          ...Object.fromEntries(others),
          [deployment]: [item, ...(state.runs[deployment] ?? [])].slice(0, MAX_RUNS),
        },
      };
    }),
  clear: (deployment) =>
    set((state) => {
      const { [deployment]: _removed, ...rest } = state.runs;
      return { runs: rest };
    }),
  clearProfile: (profileId) =>
    set((state) => ({
      runs: Object.fromEntries(
        Object.entries(state.runs).filter(([key]) => !key.startsWith(`${profileId}:`)),
      ),
    })),
}));
