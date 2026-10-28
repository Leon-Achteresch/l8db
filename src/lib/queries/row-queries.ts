import {
  type QueryFunctionContext,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import {
  cancelExecution,
  countTableRows,
  countTableRowsCapped,
  fetchTableRows,
  type RowCount,
  type TableData,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { sameTableSource } from "@/lib/query-client";
import { exactRowCount } from "@/lib/row-count";
import {
  isRowsWindowJump,
  ROWS_WINDOW_SETTLE_MS,
  rowsWindowExtent,
  rowsWindowFetches,
  rowsWindowRange,
  rowsWindowRun,
} from "@/lib/rows-window";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh";
import { tableReadTransactionId, useTransactionStore } from "@/lib/transactions";
import { runUntilAbandoned } from "./abandoned-jobs";
import { sortingToRowSort } from "./schema-queries";

export const PAGE_SIZE = 100;

export const ROW_COUNT_CAP = 100_000;

function cancelJob(jobId: string) {
  void cancelExecution(jobId).catch(() => undefined);
}

function rowCountKey(
  connectionId: string | undefined,
  database: string | null | undefined,
  schema: string,
  table: string,
  filter: string | undefined,
  allowRaw: boolean,
) {
  const where = filter?.trim() ? filter : "";
  return ["count", connectionId, database, schema, table, where, where ? allowRaw : true];
}

function useRowsSource(
  schema: string,
  table: string,
  filter: string | undefined,
  sorting: SortingState,
  isView: boolean,
  allowRaw: boolean,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const rowLimit = useSettingsStore((s) => s.rowLimit);
  const txId = useTransactionStore((state) =>
    tableReadTransactionId(state.transactions, connection?.id ?? "", database, schema, table),
  );
  return {
    connection,
    database,
    schema,
    table,
    filter,
    sort: sortingToRowSort(sorting),
    isView,
    rowLimit,
    allowRaw,
    txId,
  };
}

type RowsSource = ReturnType<typeof useRowsSource>;

function rowsQueryOptions(source: RowsSource, page: number) {
  const { connection, database, schema, table, filter, sort, isView, rowLimit, allowRaw, txId } =
    source;
  return {
    queryKey: [
      "rows",
      connection?.id,
      database,
      schema,
      table,
      filter ?? "",
      sort?.column ?? "",
      sort?.desc ?? false,
      isView,
      page,
      rowLimit,
      allowRaw,
      txId,
    ],
    queryFn: (context: QueryFunctionContext) => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return runUntilAbandoned(
        context,
        (jobId) =>
          fetchTableRows(
            connection.kind,
            effectiveConnectionString(connection),
            schema,
            table,
            filter,
            rowLimit,
            page * rowLimit,
            database ?? undefined,
            sort,
            isView,
            allowRaw,
            txId,
            { jobId },
          ).then((data): RowsPage => ({ ...data, fetchedRows: data.rows.length })),
        cancelJob,
      );
    },
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
  };
}

export function useTableRowsQuery(
  schema: string,
  table: string,
  filter?: string,
  sorting: SortingState = [],
  isView = false,
  page = 0,
  allowRaw = true,
) {
  const source = useRowsSource(schema, table, filter, sorting, isView, allowRaw);
  const { connection, database, txId } = source;
  const queryClient = useQueryClient();
  return useQuery({
    ...rowsQueryOptions(source, page),
    placeholderData: (previousData, previousQuery) => {
      if (
        !previousData ||
        !previousQuery ||
        (queryClient.getQueryCache().get(previousQuery.queryHash) as unknown) !== previousQuery
      ) {
        return undefined;
      }
      const previousKey = previousQuery.queryKey;
      if (
        sameTableSource(previousKey, [
          "rows",
          connection?.id,
          database,
          schema,
          table,
          "",
          "",
          false,
          isView,
          undefined,
          undefined,
          undefined,
          txId,
        ])
      ) {
        return previousData;
      }
      return undefined;
    },
  });
}

export type RowsWindowPage = { page: number; rows: TableData["rows"] };

type RowsPage = TableData & { fetchedRows: number };

type RowsWindowView = {
  source: string;
  viewKey: string;
  table: string;
  columns: string[];
  pages: RowsWindowPage[];
};

const ROWS_WINDOW_STALE_MS = 30_000;

function samePageSource(key: readonly unknown[], base: readonly unknown[]) {
  return (
    key.length === base.length && base.every((part, index) => index === 9 || part === key[index])
  );
}

export function useTableRowsWindow(
  schema: string,
  table: string,
  filter: string,
  sorting: SortingState,
  isView: boolean,
  allowRaw: boolean,
  startPage: number,
  onStartPageChange: (page: number) => void,
) {
  const source = useRowsSource(schema, table, filter, sorting, isView, allowRaw);
  const { connection, database, rowLimit, txId } = source;
  const queryClient = useQueryClient();
  const baseKey = rowsQueryOptions(source, -1).queryKey;
  const sourceKey = JSON.stringify(baseKey);
  const viewKey = JSON.stringify(baseKey.slice(0, -1));
  const tableKey = JSON.stringify([connection?.id, database, schema, table, isView]);
  const [view, setView] = useState(() => ({
    source: sourceKey,
    viewKey,
    first: startPage,
    last: startPage,
    center: startPage,
  }));
  const range =
    view.source === sourceKey
      ? view
      : view.viewKey === viewKey
        ? { ...view, source: sourceKey }
        : { source: sourceKey, viewKey, first: startPage, last: startPage, center: startPage };
  const totalCount = exactRowCount(
    queryClient.getQueryData<RowCount>([
      ...rowCountKey(connection?.id, database, schema, table, filter, allowRaw),
      txId,
    ]),
  );
  const pageNumbers: number[] = [];
  for (let page = range.first; page <= range.last; page++) pageNumbers.push(page);
  const pageKey = (page: number) => rowsQueryOptions(source, page).queryKey;
  const cached = (page: number) => queryClient.getQueryData<RowsPage>(pageKey(page)) !== undefined;
  const settled = (page: number) =>
    cached(page) || queryClient.getQueryState(pageKey(page))?.status === "error";
  const fetches = rowsWindowFetches(range, settled);
  const results = useQueries({
    queries: pageNumbers.map((page) => {
      const options = rowsQueryOptions(source, page);
      return {
        ...options,
        enabled: options.enabled && (fetches.has(page) || settled(page)),
        staleTime: ROWS_WINDOW_STALE_MS,
      };
    }),
  });
  const loaded = (page: number) => results[page - range.first]?.data;
  const bounds = useRef<{ source: string; endRow?: number; extent: number }>({
    source: sourceKey,
    extent: 0,
  });
  if (bounds.current.source !== sourceKey) bounds.current = { source: sourceKey, extent: 0 };
  let endRow = bounds.current.endRow;
  for (const page of pageNumbers) {
    const data = loaded(page);
    if (!data) continue;
    if (data.fetchedRows < rowLimit) {
      endRow = page * rowLimit + data.rows.length;
      break;
    }
    if (endRow !== undefined && (page + 1) * rowLimit > endRow) endRow = undefined;
  }
  const run = rowsWindowRun(range, (page) => loaded(page) !== undefined);
  const rowExtent = rowsWindowExtent(
    rowLimit,
    Math.max(range.last, run?.end ?? 0),
    totalCount,
    endRow,
    bounds.current.extent,
  );
  bounds.current = { source: sourceKey, endRow, extent: rowExtent };
  const previous = useRef<RowsWindowView | null>(null);
  if (run) {
    const pages: RowsWindowPage[] = [];
    for (let page = run.start; page <= run.end; page++)
      pages.push({ page, rows: loaded(page)?.rows ?? [] });
    const last = previous.current;
    const unchanged =
      last?.source === sourceKey &&
      last.pages.length === pages.length &&
      last.pages.every(
        (entry, index) => entry.page === pages[index].page && entry.rows === pages[index].rows,
      );
    if (!unchanged)
      previous.current = {
        source: sourceKey,
        viewKey,
        table: tableKey,
        columns: loaded(run.start)?.columns ?? [],
        pages,
      };
  }
  const shown = previous.current?.table === tableKey ? previous.current : null;
  const placeholder = shown !== null && shown.source !== sourceKey;
  const shownStart = shown?.pages[0]?.page ?? 0;
  let rowOffset = shownStart * rowLimit;
  if (placeholder && shown.viewKey !== viewKey) rowOffset = 0;
  else if (!placeholder && shownStart > 0)
    for (const [, data] of queryClient.getQueriesData<RowsPage>({
      predicate: (query) =>
        samePageSource(query.queryKey, baseKey) && Number(query.queryKey[9]) < shownStart,
    }))
      if (data) rowOffset += data.rows.length - data.fetchedRows;
  const center = results[range.center - range.first];
  const failedCenter = center?.isError && center.data === undefined ? center : undefined;
  const failedAny = results.find((result) => result.isError && result.data === undefined);
  const failed = failedCenter ?? (shown === null || placeholder ? failedAny : undefined);
  const latest = useRef({
    range,
    rowLimit,
    endRow,
    totalCount,
    sourceKey,
    viewKey,
    baseKey,
    settled,
  });
  latest.current = { range, rowLimit, endRow, totalCount, sourceKey, viewKey, baseKey, settled };
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);
  const onVisibleRowsChange = useCallback((firstRow: number, lastRow: number) => {
    const { range, rowLimit, endRow, totalCount, sourceKey, viewKey, settled } = latest.current;
    const next = rowsWindowRange(firstRow, lastRow, rowLimit, endRow ?? totalCount);
    if (rowsWindowFetches(next, settled).size === 0) next.center = range.center;
    if (
      range.source === sourceKey &&
      range.first === next.first &&
      range.last === next.last &&
      range.center === next.center
    ) {
      clearTimeout(settle.current);
      return;
    }
    const apply = () =>
      startTransition(() =>
        setView((current) =>
          current.source === sourceKey &&
          current.first === next.first &&
          current.last === next.last &&
          current.center === next.center
            ? current
            : { source: sourceKey, viewKey, ...next },
        ),
      );
    clearTimeout(settle.current);
    if (isRowsWindowJump(range, next)) settle.current = setTimeout(apply, ROWS_WINDOW_SETTLE_MS);
    else apply();
  }, []);
  const keptStart = useRef(startPage);
  if (shown && !placeholder) keptStart.current = shownStart;
  useEffect(() => () => onStartPageChange(keptStart.current), [onStartPageChange]);
  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries(
        { predicate: (query) => samePageSource(query.queryKey, latest.current.baseKey) },
        { throwOnError: true },
      ),
    [queryClient],
  );
  return {
    columns: shown?.columns,
    pages: shown?.pages ?? NO_PAGES,
    rowOffset,
    rowExtent,
    onVisibleRowsChange,
    isLoading: shown === null && !failedAny,
    isFetching: placeholder || Boolean(center?.isFetching && center.data !== undefined),
    isError: failed !== undefined,
    error: failed?.error ?? null,
    refresh,
  };
}

const NO_PAGES: RowsWindowPage[] = [];

export function useTableRowCountQuery(
  schema: string,
  table: string,
  filter?: string,
  allowRaw = true,
  enabled = true,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const txId = useTransactionStore((state) =>
    tableReadTransactionId(state.transactions, connection?.id ?? "", database, schema, table),
  );
  return useQuery<RowCount>({
    queryKey: [...rowCountKey(connection?.id, database, schema, table, filter, allowRaw), txId],
    queryFn: (context) => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return runUntilAbandoned(
        context,
        (jobId) =>
          countTableRowsCapped(
            connection.kind,
            effectiveConnectionString(connection),
            schema,
            table,
            ROW_COUNT_CAP,
            filter,
            database ?? undefined,
            allowRaw,
            txId,
            { jobId },
          ),
        cancelJob,
      );
    },
    enabled: enabled && Boolean(connection) && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useExactRowCountMutation(
  schema: string,
  table: string,
  filter?: string,
  allowRaw = true,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const txId = useTransactionStore((state) =>
    tableReadTransactionId(state.transactions, connection?.id ?? "", database, schema, table),
  );
  return useMutation({
    mutationFn: () => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return countTableRows(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        filter,
        database ?? undefined,
        allowRaw,
        txId,
      );
    },
    onSuccess: (count) =>
      queryClient.setQueryData<RowCount>(
        [...rowCountKey(connection?.id, database, schema, table, filter, allowRaw), txId],
        { count, exact: true, estimate: null },
      ),
  });
}
