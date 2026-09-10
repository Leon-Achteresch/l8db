import { useCallback, useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TableColumnPref = {
  order: string[];
  hidden: string[];
};

interface TableColumnPrefsState {
  prefs: Record<string, TableColumnPref>;
  setPref: (key: string, pref: TableColumnPref) => void;
  resetPref: (key: string) => void;
}

export function tableColumnPrefKey(
  connectionId: string,
  schema: string,
  table: string,
): string {
  return `${connectionId}:${schema}.${table}`;
}

export function resolveColumnPrefs(
  columns: string[],
  saved: TableColumnPref | undefined,
): TableColumnPref {
  const known = new Set(columns);
  const savedOrder = saved?.order?.filter((column) => known.has(column)) ?? [];
  const savedSet = new Set(savedOrder);
  const order = [...savedOrder, ...columns.filter((column) => !savedSet.has(column))];
  const hidden = (saved?.hidden ?? []).filter((column) => known.has(column));
  if (order.length > 0 && hidden.length >= order.length) {
    return { order, hidden: hidden.filter((column) => column !== order[0]) };
  }
  return { order, hidden };
}

export function reorderVisibleColumns(
  order: string[],
  hidden: string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  const hiddenSet = new Set(hidden);
  const visible = order.filter((column) => !hiddenSet.has(column));
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= visible.length ||
    toIndex >= visible.length
  ) {
    return order;
  }
  const nextVisible = [...visible];
  const [moved] = nextVisible.splice(fromIndex, 1);
  nextVisible.splice(toIndex, 0, moved);
  let index = 0;
  return order.map((column) => (hiddenSet.has(column) ? column : nextVisible[index++]));
}

export function moveColumn(order: string[], fromIndex: number, toIndex: number): string[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length
  ) {
    return order;
  }
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function toggleHiddenColumn(order: string[], hidden: string[], column: string): string[] {
  if (!order.includes(column)) return hidden;
  if (hidden.includes(column)) return hidden.filter((entry) => entry !== column);
  if (order.length - hidden.length <= 1) return hidden;
  return [...hidden, column];
}

export const useTableColumnPrefs = create<TableColumnPrefsState>()(
  persist(
    (set) => ({
      prefs: {},
      setPref: (key, pref) =>
        set((state) => ({
          prefs: { ...state.prefs, [key]: pref },
        })),
      resetPref: (key) =>
        set((state) => {
          const prefs = { ...state.prefs };
          delete prefs[key];
          return { prefs };
        }),
    }),
    { name: "l8db.table-column-prefs" },
  ),
);

export function useTableColumnLayout(
  connectionId: string | null | undefined,
  schema: string | undefined,
  table: string | undefined,
  columns: string[],
) {
  const key =
    connectionId && schema && table ? tableColumnPrefKey(connectionId, schema, table) : null;
  const saved = useTableColumnPrefs((state) => (key ? state.prefs[key] : undefined));
  const setPref = useTableColumnPrefs((state) => state.setPref);
  const resetPref = useTableColumnPrefs((state) => state.resetPref);
  const [ephemeral, setEphemeral] = useState<TableColumnPref | undefined>();
  const source = key ? saved : ephemeral;
  const resolved = useMemo(() => resolveColumnPrefs(columns, source), [columns, source]);

  const write = useCallback(
    (pref: TableColumnPref) => {
      if (key) {
        setPref(key, pref);
        return;
      }
      setEphemeral(pref);
    },
    [key, setPref],
  );

  const setOrder = useCallback(
    (order: string[]) => {
      write({ order, hidden: resolved.hidden });
    },
    [write, resolved.hidden],
  );

  const setHidden = useCallback(
    (hidden: string[]) => {
      write({ order: resolved.order, hidden });
    },
    [write, resolved.order],
  );

  const reset = useCallback(() => {
    if (key) {
      resetPref(key);
      return;
    }
    setEphemeral(undefined);
  }, [key, resetPref]);

  return {
    order: resolved.order,
    hidden: resolved.hidden,
    setOrder,
    setHidden,
    reset,
    isCustomized: source !== undefined,
  };
}
