import { createContext } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { scanBindParams } from "@/lib/bind-params";
import { createChangedOnlyJsonStorage } from "@/lib/buffered-storage";
import { useConnectionsStore } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { isReadOnlyStatement } from "@/lib/perf-test";
import { usePaneConnectionId } from "@/lib/split-view";
import { quoteString } from "@/lib/sql-filter";

export type MasterCell = {
  column: string;
  rowIndex: number;
  value: unknown;
  row?: Record<string, unknown>;
};
export const MasterSelectionContext = createContext<string | null>(null);

export type SavedMasterDetail = { master: string; detail: string; sql: string; column?: string };

interface MasterDetailState {
  savedScripts: Record<string, SavedMasterDetail>;
  removeSavedScript: (key: string) => void;
  scripts: Record<string, string>;
  sourceColumns: Record<string, string>;
  selections: Record<string, MasterCell>;
  saveScript: (
    key: string,
    sql: string,
    pair?: { master: string; detail: string; column?: string },
  ) => void;
  removeScript: (key: string) => void;
  selectCell: (key: string, cell: MasterCell | null) => void;
}

export function masterColumnSelection(
  selection: MasterCell | undefined,
  column?: string,
): MasterCell | undefined {
  if (!selection || !column) return selection;
  if (selection.row && Object.hasOwn(selection.row, column))
    return { ...selection, column, value: selection.row[column] };
  return selection.column === column ? selection : undefined;
}

function masterParams(sql: string) {
  return scanBindParams(sql).map((param) => {
    if (!param.named || param.name !== "master" || sql[param.end] !== ".")
      return { ...param, column: undefined };
    const suffix = sql
      .slice(param.end)
      .match(/^\.(?:([\p{L}_][\p{L}\p{N}_$#]*)|"((?:[^"]|"")+)")/u);
    if (!suffix) throw new Error("Nach :master. fehlt ein gültiger Spaltenname.");
    const end = param.end + suffix[0].length;
    if (sql[end] === ".") throw new Error("Verwende :master.SPALTE ohne weitere Pfadsegmente.");
    return { ...param, end, column: suffix[1] ?? suffix[2].replace(/""/g, '"') };
  });
}

export function masterColumnReference(column: string): string {
  return `:master.${/^[\p{L}_][\p{L}\p{N}_$#]*$/u.test(column) ? column : `"${column.replace(/"/g, '""')}"`}`;
}

export function qualifyMasterDetail(sql: string, column?: string): string {
  if (!column) return sql;
  let result = sql;
  for (const param of masterParams(sql).reverse()) {
    if (param.named && param.name === "master" && param.column === undefined)
      result = `${result.slice(0, param.start)}${masterColumnReference(column)}${result.slice(param.end)}`;
  }
  return result;
}

export function masterDetailScriptError(sql: string): string | null {
  if (!isReadOnlyStatement(sql) || /\b(into|for\s+update)\b/i.test(sql)) {
    return "Bitte eine einzelne lesende SQL-Abfrage eingeben.";
  }
  try {
    const params = masterParams(sql);
    if (!params.some((param) => param.named && param.name === "master")) {
      return "Verwende :master.SPALTE für einen Wert aus der ausgewählten Master-Zeile.";
    }
    if (params.some((param) => !param.named || param.name !== "master")) {
      return "Verwende für Master-Spalten die Schreibweise :master.SPALTE.";
    }
    return null;
  } catch (error) {
    return String(error instanceof Error ? error.message : error);
  }
}

export function bindMasterDetail(
  sql: string,
  value: unknown,
  row?: Record<string, unknown>,
  literal?: (value: unknown) => string,
) {
  const error = masterDetailScriptError(sql);
  if (error) throw new Error(error);
  const indexes = new Map<string | undefined, number>();
  const params: (string | null)[] = [];
  const values: unknown[] = [];
  const occurrences = masterParams(sql).map((param) => {
    if (!indexes.has(param.column)) {
      if (param.column !== undefined && (!row || !Object.hasOwn(row, param.column)))
        throw new Error(`Die Spalte „${param.column}“ fehlt in der ausgewählten Master-Zeile.`);
      const entry = param.column === undefined ? value : row?.[param.column];
      values.push(entry);
      params.push(
        entry == null ? null : typeof entry === "object" ? JSON.stringify(entry) : String(entry),
      );
      indexes.set(param.column, params.length);
    }
    return { ...param, index: indexes.get(param.column) };
  });
  let boundSql = sql;
  for (const param of occurrences.reverse()) {
    const placeholder = literal ? literal(values[(param.index ?? 1) - 1]) : `$${param.index}`;
    boundSql = `${boundSql.slice(0, param.start)}${placeholder}${boundSql.slice(param.end)}`;
  }
  return { sql: boundSql, params };
}

export function masterDetailLiteral(value: unknown, kind: DatabaseKind): string {
  if (value == null) return "NULL";
  return quoteString(typeof value === "object" ? JSON.stringify(value) : String(value), kind);
}

const IDENT = String.raw`(?:"((?:[^"]|"")+)"|\x60([^\x60]+)\x60|\[([^\]]+)\]|([\p{L}_][\p{L}\p{N}_$#]*))`;
const SINGLE_TABLE = new RegExp(
  String.raw`^\s*select\s+(?:top\s*\(?\s*(\d+)\s*\)?\s+)?\*\s+from\s+${IDENT}\s*\.\s*${IDENT}\s+where\s+([\s\S]+?)(?:\s+limit\s+(\d+)|\s+fetch\s+first\s+(\d+)\s+rows?\s+only)?\s*;?\s*$`,
  "iu",
);

export function masterDetailTable(sql: string, kind: DatabaseKind) {
  const match = sql.match(SINGLE_TABLE);
  if (!match) return null;
  const where = match[10];
  const unquoted = where.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "''");
  if (
    /[;]|--|\/\*|\b(?:limit|offset|fetch|for|order|group|having|union|intersect|except|window)\b/i.test(
      unquoted,
    ) ||
    /(?:''|[\p{L}_\]\x60])\s*\.\s*(?:''|[\p{L}_[\x60])/u.test(unquoted)
  )
    return null;
  const name = (offset: number) => {
    const bare = match[offset + 3];
    if (bare === undefined)
      return (match[offset] ?? match[offset + 1] ?? match[offset + 2]).replace(/""/g, '"');
    return kind === "oracle" ? bare.toUpperCase() : kind === "postgres" ? bare.toLowerCase() : bare;
  };
  const limit = match[1] ?? match[11] ?? match[12];
  return {
    schema: name(2),
    table: name(6),
    where,
    limit: limit === undefined ? undefined : Number(limit),
  };
}

export const useMasterDetail = create<MasterDetailState>()(
  persist(
    (set) => ({
      savedScripts: {},
      removeSavedScript: (key) =>
        set((state) => {
          const savedScripts = { ...state.savedScripts };
          delete savedScripts[key];
          return { savedScripts };
        }),
      scripts: {},
      sourceColumns: {},
      selections: {},
      saveScript: (key, sql, pair) => {
        const error = masterDetailScriptError(sql);
        if (error) throw new Error(error);
        set((state) => ({
          scripts: { ...state.scripts, [key]: sql.trim() },
          sourceColumns: { ...state.sourceColumns, [key]: pair?.column ?? "" },
          savedScripts: pair
            ? { ...state.savedScripts, [key]: { ...pair, sql: sql.trim() } }
            : state.savedScripts,
        }));
      },
      removeScript: (key) =>
        set((state) => {
          const scripts = { ...state.scripts };
          delete scripts[key];
          const sourceColumns = { ...state.sourceColumns };
          delete sourceColumns[key];
          return { scripts, sourceColumns };
        }),
      selectCell: (key, cell) =>
        set((state) => {
          const previous = state.selections[key];
          if (
            previous?.column === cell?.column &&
            previous?.rowIndex === cell?.rowIndex &&
            Object.is(previous?.value, cell?.value) &&
            previous?.row === cell?.row
          )
            return state;
          const selections = { ...state.selections };
          if (cell) selections[key] = cell;
          else delete selections[key];
          return { selections };
        }),
    }),
    {
      name: "l8db.master-detail",
      storage: createChangedOnlyJsonStorage(),
      partialize: (state) => ({
        scripts: state.scripts,
        savedScripts: state.savedScripts,
        sourceColumns: state.sourceColumns,
      }),
    },
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
