import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveConnection } from "@/lib/connections";
import {
  deleteRowInTransaction,
  duplicateRowInTransaction,
  insertRowInTransaction,
  type TableData,
  updateRowInTransaction,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { runTableTransaction } from "@/lib/managed-transactions";

export function useUpdateRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ctid,
      updates,
      oldValues,
    }: {
      ctid: string;
      updates: Record<string, string | null>;
      oldValues: Record<string, unknown>;
    }) => {
      const queryKey = ["rows", connection?.id, database, schema, table];
      const changedUpdates: Record<string, string | null> = {};
      const changedOld: Record<string, unknown> = {};
      for (const [col, newVal] of Object.entries(updates)) {
        const orig = oldValues[col];
        let origStr: string | null;
        if (orig === null || orig === undefined) {
          origStr = null;
        } else if (typeof orig === "object") {
          origStr = JSON.stringify(orig);
        } else {
          origStr = String(orig);
        }
        if (newVal !== origStr) {
          changedUpdates[col] = newVal;
          changedOld[col] = orig;
        }
      }

      if (Object.keys(changedUpdates).length === 0) {
        return { newCtid: ctid, queryKey };
      }

      const newCtid = await runTableTransaction(
        connection!,
        database ?? null,
        schema,
        table,
        (txId) => updateRowInTransaction(txId, schema, table, ctid, changedUpdates),
        () => ({
          type: "update",
          schema,
          table,
          ctid,
          oldValues: changedOld,
          newValues: changedUpdates,
        }),
      );

      return { newCtid, queryKey };
    },
    onSuccess: (result, { ctid, updates }) => {
      queryClient.setQueriesData<TableData>({ queryKey: result.queryKey }, (old) => {
        if (!old) return old;
        const idx = old.rows.findIndex((r) => (r as Record<string, unknown>).__ctid__ === ctid);
        if (idx === -1) return old;
        const updatedRows = [...old.rows];
        updatedRows[idx] = {
          ...updatedRows[idx],
          __ctid__: result.newCtid,
          ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v])),
        };
        return { ...old, rows: updatedRows };
      });
    },
  });
}

function splitRow(row: unknown) {
  const { __ctid__: ctid, ...rowValues } = row as { __ctid__?: string; [key: string]: unknown };
  return { ctid, rowValues };
}

function matchesTable(
  queryKey: readonly unknown[],
  root: string,
  schema: string,
  table: string,
  connectionId: string | undefined,
  database: string | null | undefined,
): boolean {
  return (
    queryKey[0] === root &&
    queryKey[1] === connectionId &&
    (queryKey[2] ?? null) === (database ?? null) &&
    queryKey[3] === schema &&
    queryKey[4] === table
  );
}

export function useInsertRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, string | null>) => {
      const row = await runTableTransaction(
        connection!,
        database ?? null,
        schema,
        table,
        (txId) => insertRowInTransaction(txId, schema, table, values),
        (inserted) => ({ type: "insert", schema, table, ...splitRow(inserted) }),
      );
      return { row };
    },
    onSuccess: ({ row }) => {
      queryClient.setQueriesData<TableData>(
        {
          predicate: (q) =>
            matchesTable(q.queryKey, "rows", schema, table, connection?.id, database),
        },
        (old) => (old ? { ...old, rows: [...old.rows, row] } : old),
      );
      queryClient.setQueriesData<number>(
        {
          predicate: (q) =>
            matchesTable(q.queryKey, "count", schema, table, connection?.id, database),
        },
        (old) => (typeof old === "number" ? old + 1 : old),
      );
    },
  });
}

export function useDuplicateRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ctid: string) => {
      const row = await runTableTransaction(
        connection!,
        database ?? null,
        schema,
        table,
        (txId) => duplicateRowInTransaction(txId, schema, table, ctid),
        (inserted) => ({ type: "insert", schema, table, ...splitRow(inserted) }),
      );
      return { row };
    },
    onSuccess: ({ row }) => {
      queryClient.setQueriesData<TableData>(
        {
          predicate: (q) =>
            matchesTable(q.queryKey, "rows", schema, table, connection?.id, database),
        },
        (old) => (old ? { ...old, rows: [...old.rows, row] } : old),
      );
      queryClient.setQueriesData<number>(
        {
          predicate: (q) =>
            matchesTable(q.queryKey, "count", schema, table, connection?.id, database),
        },
        (old) => (typeof old === "number" ? old + 1 : old),
      );
    },
  });
}

export function useDeleteRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ctid,
      oldValues,
    }: {
      ctid: string;
      oldValues: Record<string, unknown>;
    }) => {
      await runTableTransaction(
        connection!,
        database ?? null,
        schema,
        table,
        (txId) => deleteRowInTransaction(txId, schema, table, ctid),
        () => ({ type: "delete", schema, table, ctid, oldValues }),
      );
      return { ctid };
    },
    onSuccess: ({ ctid }) => {
      queryClient.setQueriesData<TableData>(
        {
          predicate: (q) =>
            matchesTable(q.queryKey, "rows", schema, table, connection?.id, database),
        },
        (old) =>
          old
            ? {
                ...old,
                rows: old.rows.filter((r) => (r as Record<string, unknown>).__ctid__ !== ctid),
              }
            : old,
      );
      queryClient.setQueriesData<number>(
        {
          predicate: (q) =>
            matchesTable(q.queryKey, "count", schema, table, connection?.id, database),
        },
        (old) => (typeof old === "number" ? Math.max(0, old - 1) : old),
      );
    },
  });
}
