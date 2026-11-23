import { create } from "zustand";
import { changedRowValues } from "@/lib/cell-editor";
import type { SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections/store";
import {
  applyRowChangesInTransaction,
  beginTransaction,
  commitTransaction,
  previewRowChanges,
  type RowChange,
  type RowChangeSql,
  rollbackTransaction,
} from "@/lib/db";
import { isProduction } from "@/lib/environments";
import { confirmProductionCommit } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh/connection-string";
import { withTableServerOutput } from "@/lib/table-server-output";
import { findTransaction, type TransactionChange, useTransactionStore } from "@/lib/transactions";

export const STAGED_ROW_PREFIX = "staged:";

type Values = Record<string, string | null>;

export type StagedChange =
  | { id: string; type: "update"; ctid: string; original: Record<string, unknown>; updates: Values }
  | { id: string; type: "insert"; values: Values }
  | { id: string; type: "delete"; ctid: string; original: Record<string, unknown> };

type RowStagedChange = Exclude<StagedChange, { type: "insert" }>;

export interface StagedTarget {
  connectionId: string;
  database: string | null;
  schema: string;
  table: string;
}

export interface StagedTable extends StagedTarget {
  changes: StagedChange[];
  failedId?: string;
  error?: string;
}

interface StagedEditsState {
  tables: Record<string, StagedTable>;
  committing: string[];
}

export const useStagedEdits = create<StagedEditsState>(() => ({ tables: {}, committing: [] }));

export function stagedTableKey(target: StagedTarget): string {
  return JSON.stringify([target.connectionId, target.database, target.schema, target.table]);
}

let nextId = 0;
const newId = () => `c${++nextId}`;

function writeChanges(target: StagedTarget, change: (list: StagedChange[]) => StagedChange[]) {
  const key = stagedTableKey(target);
  const state = useStagedEdits.getState();
  if (state.committing.includes(key)) throw new Error("Die Änderungen werden gerade übernommen.");
  const current = state.tables[key]?.changes ?? [];
  const changes = change(current);
  if (changes === current) return;
  const tables = { ...state.tables };
  if (changes.length)
    tables[key] = {
      connectionId: target.connectionId,
      database: target.database,
      schema: target.schema,
      table: target.table,
      changes,
    };
  else delete tables[key];
  useStagedEdits.setState({ tables });
}

function replaceAt(list: StagedChange[], index: number, next: StagedChange | null) {
  const copy = list.slice();
  if (next) copy[index] = next;
  else copy.splice(index, 1);
  return copy;
}

export function insertIdOf(ctid: string): string | null {
  return ctid.startsWith(STAGED_ROW_PREFIX) ? ctid.slice(STAGED_ROW_PREFIX.length) : null;
}

export function stageUpdate(
  target: StagedTarget,
  ctid: string,
  updates: Values,
  displayed: Record<string, unknown>,
) {
  writeChanges(target, (list) => {
    const insertId = insertIdOf(ctid);
    if (insertId) {
      const index = list.findIndex((entry) => entry.id === insertId);
      const entry = list[index];
      if (entry?.type !== "insert") return list;
      const changed = changedRowValues(updates, displayed).updates;
      if (!Object.keys(changed).length) return list;
      return replaceAt(list, index, { ...entry, values: { ...entry.values, ...changed } });
    }
    const index = list.findIndex((entry) => entry.type !== "insert" && entry.ctid === ctid);
    const entry = list[index] as RowStagedChange | undefined;
    if (entry?.type === "delete") return list;
    const original = entry?.type === "update" ? entry.original : displayed;
    const changed = changedRowValues(updates, original).updates;
    const empty = Object.keys(changed).length === 0;
    if (!entry)
      return empty
        ? list
        : [...list, { id: newId(), type: "update", ctid, original, updates: changed }];
    return replaceAt(list, index, empty ? null : { ...entry, updates: changed });
  });
}

export function stageInsert(target: StagedTarget, values: Values) {
  stageInserts(target, [values]);
}

export function stageInserts(target: StagedTarget, rows: Values[]) {
  writeChanges(target, (list) => [
    ...list,
    ...rows.map((values): StagedChange => ({ id: newId(), type: "insert", values })),
  ]);
}

export function stageDelete(
  target: StagedTarget,
  ctid: string,
  displayed: Record<string, unknown>,
) {
  writeChanges(target, (list) => {
    const insertId = insertIdOf(ctid);
    if (insertId) return list.filter((entry) => entry.id !== insertId);
    const index = list.findIndex((entry) => entry.type !== "insert" && entry.ctid === ctid);
    const entry = list[index] as RowStagedChange | undefined;
    if (entry?.type === "delete") return list;
    if (!entry) return [...list, { id: newId(), type: "delete", ctid, original: displayed }];
    return replaceAt(list, index, { id: entry.id, type: "delete", ctid, original: entry.original });
  });
}

export function discardStagedChange(key: string, id: string) {
  const entry = useStagedEdits.getState().tables[key];
  if (entry) writeChanges(entry, (list) => list.filter((change) => change.id !== id));
}

export function discardStagedTable(key: string) {
  const state = useStagedEdits.getState();
  if (!state.tables[key] || state.committing.includes(key)) return;
  const tables = { ...state.tables };
  delete tables[key];
  useStagedEdits.setState({ tables });
}

export function hasStagedChanges(connectionId: string): boolean {
  return Object.values(useStagedEdits.getState().tables).some(
    (entry) => entry.connectionId === connectionId,
  );
}

export function collectsTableChanges(
  connection: SavedConnection,
  database: string | null,
  schema: string,
  table: string,
): boolean {
  if (
    useStagedEdits.getState().tables[
      stagedTableKey({ connectionId: connection.id, database, schema, table })
    ]
  )
    return true;
  const mode = useSettingsStore.getState().collectCellEdits;
  if (mode === "off" || (mode === "production" && !isProduction(connection))) return false;
  if (connection.readOnly || connection.kind === "dynamodb") return false;
  if (!supports(connection, "transactions") || !supports(connection, "row_edit")) return false;
  return !findTransaction(useTransactionStore.getState().transactions, connection.id, database, {
    type: "table",
    schema,
    table,
  });
}

export function toRowChange(change: StagedChange): RowChange {
  if (change.type === "update")
    return { type: "update", ctid: change.ctid, updates: change.updates };
  if (change.type === "delete") return { type: "delete", ctid: change.ctid };
  return { type: "insert", values: change.values };
}

function toTransactionChange(
  entry: StagedTable,
  change: StagedChange,
): Omit<TransactionChange, "id" | "timestamp"> {
  const base = { schema: entry.schema, table: entry.table };
  if (change.type === "update")
    return {
      ...base,
      type: "update",
      ctid: change.ctid,
      oldValues: change.original,
      newValues: change.updates,
    };
  if (change.type === "delete")
    return { ...base, type: "delete", ctid: change.ctid, oldValues: change.original };
  return { ...base, type: "insert", rowValues: change.values };
}

function stagedConnection(entry: StagedTarget): SavedConnection {
  const connection = useConnectionsStore
    .getState()
    .connections.find((item) => item.id === entry.connectionId);
  if (!connection) throw new Error("Verbindung nicht gefunden.");
  return connection;
}

export async function previewStagedTable(key: string): Promise<RowChangeSql[]> {
  const entry = useStagedEdits.getState().tables[key];
  if (!entry) return [];
  const connection = stagedConnection(entry);
  return previewRowChanges(
    connection.kind,
    effectiveConnectionString(connection),
    entry.database ?? undefined,
    entry.schema,
    entry.table,
    entry.changes.map(toRowChange),
  );
}

const SQL_PREVIEW_LIMIT = 4000;

export function stagedSqlText(entry: StagedTable, statements: RowChangeSql[]): string {
  return statements
    .map(({ index, sql, params }) => {
      const text = sql.length > SQL_PREVIEW_LIMIT ? `${sql.slice(0, SQL_PREVIEW_LIMIT)}…` : sql;
      const failed =
        entry.failedId && entry.changes[index]?.id === entry.failedId
          ? `-- Fehlgeschlagen: ${entry.error ?? ""}\n`
          : "";
      const binds = params.map((param) => `\n-- ${param}`).join("");
      return `${failed}${text};${binds}`;
    })
    .join("\n\n");
}

function setFailure(key: string, failedId: string | undefined, error: string) {
  useStagedEdits.setState((state) => {
    const entry = state.tables[key];
    return entry ? { tables: { ...state.tables, [key]: { ...entry, failedId, error } } } : state;
  });
}

export async function commitStagedTable(key: string): Promise<number> {
  const state = useStagedEdits.getState();
  const entry = state.tables[key];
  if (!entry?.changes.length) return 0;
  if (state.committing.includes(key)) throw new Error("Die Änderungen werden gerade übernommen.");
  const connection = stagedConnection(entry);
  const changes = entry.changes;
  useStagedEdits.setState({
    committing: [...state.committing, key],
    tables: { ...state.tables, [key]: { ...entry, failedId: undefined, error: undefined } },
  });
  try {
    await confirmProductionCommit(
      connection.id,
      entry.database,
      changes.map((change) => toTransactionChange(entry, change)),
    );
    const txId = await beginTransaction(
      connection.kind,
      effectiveConnectionString(connection),
      entry.database ?? undefined,
    ).catch((error) => {
      setFailure(key, undefined, String(error));
      throw error;
    });
    try {
      const outcome = await withTableServerOutput(connection, entry.database, txId, () =>
        applyRowChangesInTransaction(txId, entry.schema, entry.table, changes.map(toRowChange)),
      );
      if (outcome.failed !== null) {
        const message = outcome.error ?? "Änderung fehlgeschlagen.";
        setFailure(key, changes[outcome.failed]?.id, message);
        throw new Error(`Änderung ${outcome.failed + 1} von ${changes.length}: ${message}`);
      }
      await commitTransaction(txId);
    } catch (error) {
      await rollbackTransaction(txId).catch(() => undefined);
      if (!useStagedEdits.getState().tables[key]?.error) setFailure(key, undefined, String(error));
      throw error;
    }
    useStagedEdits.setState((current) => {
      const tables = { ...current.tables };
      delete tables[key];
      return { tables };
    });
    return changes.length;
  } finally {
    useStagedEdits.setState((current) => ({
      committing: current.committing.filter((item) => item !== key),
    }));
  }
}

export function isUserCancel(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes("abgebrochen");
}

export interface StagedMark {
  type: StagedChange["type"];
  changeId: string;
  columns: Set<string> | null;
  failed: boolean;
}

const marks = new WeakMap<object, StagedMark>();

export function stagedMarkOf(row: object): StagedMark | undefined {
  return marks.get(row);
}

interface StagedIndex {
  byCtid: Map<string, StagedChange>;
  inserts: Record<string, unknown>[];
}

const indexes = new WeakMap<StagedTable, StagedIndex>();

function indexOf(entry: StagedTable): StagedIndex {
  let index = indexes.get(entry);
  if (index) return index;
  const byCtid = new Map<string, StagedChange>();
  const inserts: Record<string, unknown>[] = [];
  for (const change of entry.changes) {
    if (change.type !== "insert") {
      byCtid.set(change.ctid, change);
      continue;
    }
    const row = { ...change.values, __ctid__: `${STAGED_ROW_PREFIX}${change.id}` };
    marks.set(row, {
      type: "insert",
      changeId: change.id,
      columns: new Set(Object.keys(change.values)),
      failed: entry.failedId === change.id,
    });
    inserts.push(row);
  }
  index = { byCtid, inserts };
  indexes.set(entry, index);
  return index;
}

export function overlayStagedRows(
  rows: Record<string, unknown>[],
  entry: StagedTable | undefined,
  withInserts: boolean,
): Record<string, unknown>[] {
  if (!entry) return rows;
  const { byCtid, inserts } = indexOf(entry);
  let out: Record<string, unknown>[] | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const change = byCtid.size ? byCtid.get(row.__ctid__ as string) : undefined;
    if (!change || change.type === "insert") continue;
    out ??= rows.slice();
    const next = change.type === "update" ? { ...row, ...change.updates } : { ...row };
    marks.set(next, {
      type: change.type,
      changeId: change.id,
      columns: change.type === "update" ? new Set(Object.keys(change.updates)) : null,
      failed: entry.failedId === change.id,
    });
    out[i] = next;
  }
  if (withInserts && inserts.length) return [...inserts, ...(out ?? rows)];
  return out ?? rows;
}
