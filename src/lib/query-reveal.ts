import { create } from "zustand";

export interface QueryRevealRequest {
  tabId: string;
  line: number;
  column: number;
  length: number;
  token: number;
}

interface QueryRevealState {
  request: QueryRevealRequest | null;
  requestReveal: (target: {
    tabId: string;
    line: number;
    column?: number;
    length?: number;
  }) => void;
  clearReveal: (tabId: string) => void;
}

export const useQueryRevealStore = create<QueryRevealState>()((set, get) => ({
  request: null,
  requestReveal: (target) =>
    set({
      request: {
        tabId: target.tabId,
        line: target.line,
        column: target.column ?? 1,
        length: target.length ?? 0,
        token: Date.now() + Math.random(),
      },
    }),
  clearReveal: (tabId) => {
    if (get().request?.tabId === tabId) set({ request: null });
  },
}));
