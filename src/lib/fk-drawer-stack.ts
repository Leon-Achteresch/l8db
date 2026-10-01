import { create } from "zustand";
import { useConnectionsStore } from "@/lib/connections";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { useSplitView } from "@/lib/split-view";
import { tableViewStateKey, useTableViewStateStore } from "@/lib/table-view-state";

export interface FkDrawerEntry {
  id: string;
  schema: string;
  table: string;
  filter?: string;
  filterRaw?: boolean;
  connectionId?: string | null;
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

export function openScopedTable(
  connectionId: string,
  schema: string,
  table: string,
  filter?: string,
  filterRaw?: boolean,
) {
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === connectionId);
  const key = tableViewStateKey(
    connectionId,
    useDbSelectionStore.getState().databaseByConnection[connectionId] ??
      (connection ? databaseFromConnectionString(connection.connectionString) : null),
    schema,
    table,
  );
  if (key && filter !== undefined) {
    useTableViewStateStore.getState().patch(key, {
      filter,
      filterRaw: Boolean(filterRaw),
      sorting: [],
      page: 0,
      detailTab: "data",
    });
  }
  const { focusedPane, setPaneTab } = useSplitView.getState();
  setPaneTab(focusedPane, connectionId, { kind: "table", schema, table, entityType: "table" });
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
