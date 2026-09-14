import { create } from "zustand";

export interface FkDrawerEntry {
  id: string;
  schema: string;
  table: string;
  filter?: string;
  filterRaw?: boolean;
}

interface FkDrawerState {
  stack: FkDrawerEntry[];
  widths: Record<string, number>;
  push: (entry: Omit<FkDrawerEntry, "id">) => void;
  pop: () => void;
  popTo: (id: string) => void;
  clear: () => void;
  setWidth: (id: string, width: number) => void;
}

let counter = 0;

export const FK_DRAWER_DEFAULT_WIDTH = 1020;

export const useFkDrawerStack = create<FkDrawerState>()((set) => ({
  stack: [],
  widths: {},
  push: (entry) =>
    set((state) => {
      const last = state.stack.at(-1);
      if (
        last &&
        last.schema === entry.schema &&
        last.table === entry.table &&
        (last.filter ?? "") === (entry.filter ?? "")
      ) {
        return state;
      }
      counter += 1;
      return {
        stack: [...state.stack, { ...entry, id: `${Date.now()}-${counter}` }],
      };
    }),
  pop: () =>
    set((state) => {
      if (state.stack.length === 0) return state;
      const top = state.stack.at(-1);
      const widths = { ...state.widths };
      if (top) delete widths[top.id];
      return { stack: state.stack.slice(0, -1), widths };
    }),
  popTo: (id) =>
    set((state) => {
      const index = state.stack.findIndex((entry) => entry.id === id);
      if (index < 0) return state;
      const removed = state.stack.slice(index + 1);
      if (removed.length === 0) return state;
      const widths = { ...state.widths };
      for (const entry of removed) delete widths[entry.id];
      return { stack: state.stack.slice(0, index + 1), widths };
    }),
  clear: () => set({ stack: [], widths: {} }),
  setWidth: (id, width) => set((state) => ({ widths: { ...state.widths, [id]: width } })),
}));
