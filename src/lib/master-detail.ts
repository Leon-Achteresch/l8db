import { createContext } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { scanBindParams } from "@/lib/bind-params";
import { useConnectionsStore } from "@/lib/connections";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { isReadOnlyStatement } from "@/lib/perf-test";
import { usePaneConnectionId } from "@/lib/split-view";

export type MasterCell = { column: string; rowIndex: number; value: unknown };
export const MasterSelectionContext = createContext<string | null>(null);

interface MasterDetailState {
  scripts: Record<string, string>;
  selections: Record<string, MasterCell>;
  saveScript: (key: string, sql: string) => void;
  removeScript: (key: string) => void;
  selectCell: (key: string, cell: MasterCell | null) => void;
}

export function masterDetailScriptError(sql: string): string | null {
  if (!isReadOnlyStatement(sql) || /\b(into|for\s+update)\b/i.test(sql)) {
    return "Bitte eine einzelne lesende SQL-Abfrage eingeben.";
  }
  const params = scanBindParams(sql);
  if (!params.some((param) => param.named && param.name === "master")) {
    return "Verwende :master ohne Anführungszeichen für den ausgewählten Zellwert.";
  }
  if (params.some((param) => !param.named || param.name !== "master")) {
    return "In dieser Verknüpfung ist nur der Parameter :master verfügbar.";
  }
  return null;
}

export function bindMasterDetail(sql: string, value: unknown) {
  const error = masterDetailScriptError(sql);
  if (error) throw new Error(error);
  let boundSql = sql;
  for (const param of scanBindParams(sql).reverse()) {
    boundSql = `${boundSql.slice(0, param.start)}$1${boundSql.slice(param.end)}`;
  }
  return {
    sql: boundSql,
    params: [
      value == null ? null : typeof value === "object" ? JSON.stringify(value) : String(value),
    ],
  };
}

export const useMasterDetail = create<MasterDetailState>()(
  persist(
    (set) => ({
      scripts: {},
      selections: {},
      saveScript: (key, sql) => {
        const error = masterDetailScriptError(sql);
        if (error) throw new Error(error);
        set((state) => ({ scripts: { ...state.scripts, [key]: sql.trim() } }));
      },
      removeScript: (key) =>
        set((state) => {
          const scripts = { ...state.scripts };
          delete scripts[key];
          return { scripts };
        }),
      selectCell: (key, cell) =>
        set((state) => {
          const previous = state.selections[key];
          if (
            previous?.column === cell?.column &&
            previous?.rowIndex === cell?.rowIndex &&
            Object.is(previous?.value, cell?.value)
          )
            return state;
          const selections = { ...state.selections };
          if (cell) selections[key] = cell;
          else delete selections[key];
          return { selections };
        }),
    }),
    { name: "l8db.master-detail", partialize: (state) => ({ scripts: state.scripts }) },
  ),
);

export function usePaneSourceKey(tab: string | null): string | null {
  const activeId = useConnectionsStore((state) => state.activeId);
  const override = usePaneConnectionId(tab);
  const id = override ?? activeId;
  const connection = useConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === id),
  );
  const database = useDbSelectionStore((state) =>
    id ? state.databaseByConnection[id] : undefined,
  );
  return tab && connection
    ? JSON.stringify([
        activeId,
        tab,
        id,
        database ?? databaseFromConnectionString(connection.connectionString),
      ])
    : null;
}

export function masterDetailKey(master: string | null, detail: string | null): string | null {
  return master && detail ? JSON.stringify([master, detail]) : null;
}
