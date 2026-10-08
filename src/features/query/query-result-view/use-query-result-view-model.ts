import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useContext, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { ConnectionScopeContext, useActiveConnection } from "@/lib/connections";
import { cancelExecution, type QueryResult, type RowCount, type TableInfo } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { openScopedTable, useFkDrawerStack } from "@/lib/fk-drawer-stack";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { applyMasks } from "@/lib/masking";
import { useActiveMasks } from "@/lib/masking-display";
import { useCapabilities } from "@/lib/providers";
import { ROW_COUNT_CAP } from "@/lib/queries";
import {
  QUERY_RESULT_SCHEMA,
  queryCountSql,
  queryPageSql,
  readCount,
  resultColumnDetails,
  resultForeignKeys,
} from "@/lib/query-result-view";
import { approximateRowCount, exactRowCount } from "@/lib/row-count";
import { DEFAULT_SELECT_ROW_LIMIT } from "@/lib/select-row-limit";
import { useSettingsStore } from "@/lib/settings";
import { useTableTabs } from "@/lib/table-tabs";
import { tableViewStateKey } from "@/lib/table-view-state";
import { executeSqlWithTransactions } from "../query-view/execute-sql";
import { loadResultMeta } from "./load-result-meta";

interface Options {
  text: string;
  runId: string;
  result: QueryResult;
  tables: TableInfo[];
}

export function useQueryResultViewModel({ text, runId, result, tables }: Options) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const caps = useCapabilities(connection?.kind);
  const scopedId = useContext(ConnectionScopeContext);
  const openTab = useTableTabs((state) => state.openTab);
  const appNavigate = useNavigate();
  const queryClient = useQueryClient();
  const rowLimit = useSettingsStore((state) => state.rowLimit);
  const columns = result.columns;
  const stateKey = tableViewStateKey(connection?.id, database, QUERY_RESULT_SCHEMA, text);
  const [detailTab, setDetailTab] = useTableViewState(stateKey, "detailTab", "data");
  const [filter, setFilter] = useTableViewState(stateKey, "filter", "");
  const [filterRaw, setFilterRaw] = useTableViewState(stateKey, "filterRaw", false);
  const [sorting, setSorting] = useTableViewState(stateKey, "sorting", []);
  const [page, setPage] = useTableViewState(stateKey, "page", 0);
  const sort = sorting[0] ? { column: sorting[0].id, desc: sorting[0].desc } : null;
  const where = filter.trim();

  useEffect(() => {
    if (runId) setPage(0);
  }, [runId, setPage]);

  const complete = !result.truncated && result.rows.length < DEFAULT_SELECT_ROW_LIMIT;
  const seedRows =
    where === "" && !sort && page === 0 && (complete || result.rows.length >= rowLimit);

  const read = async (sql: string, signal: AbortSignal) => {
    if (!connection) throw new Error("Keine Verbindung aktiv.");
    let job: string | null = null;
    const abort = () => {
      if (job) void cancelExecution(job).catch(() => undefined);
    };
    signal.addEventListener("abort", abort);
    try {
      return await executeSqlWithTransactions({
        connection,
        database,
        sql,
        transactionsCapable: caps.transactions,
        onJob: (id) => {
          job = id;
        },
      });
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };

  const connectionId = connection?.id;
  const base = [connectionId, database, text, runId] as const;

  const rowsQuery = useQuery({
    queryKey: [
      "query-result-rows",
      ...base,
      where,
      sort?.column ?? "",
      sort?.desc ?? false,
      page,
      rowLimit,
    ],
    queryFn: async ({ signal }) => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      const fetched = await read(
        queryPageSql(text, connection.kind, {
          columns,
          filter: where,
          sort,
          limit: rowLimit,
          offset: page * rowLimit,
        }),
        signal,
      );
      return { columns: fetched.columns, rows: fetched.rows };
    },
    enabled: Boolean(connection),
    initialData: seedRows ? { columns, rows: result.rows.slice(0, rowLimit) } : undefined,
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const countKey = useMemo(
    () => ["query-result-count", connectionId, database, text, runId, where],
    [connectionId, database, text, runId, where],
  );
  const countQuery = useQuery<RowCount>({
    queryKey: countKey,
    queryFn: async ({ signal }) => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      const counted = await read(
        queryCountSql(text, connection.kind, columns, where, ROW_COUNT_CAP),
        signal,
      );
      const count = readCount(counted.rows);
      return { count, exact: count <= ROW_COUNT_CAP, estimate: null };
    },
    enabled: Boolean(connection) && (rowsQuery.data !== undefined || rowsQuery.isError),
    initialData:
      complete && where === ""
        ? { count: result.rows.length, exact: true, estimate: null }
        : undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const exactCount = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      const counted = await read(
        queryCountSql(text, connection.kind, columns, where),
        new AbortController().signal,
      );
      return readCount(counted.rows);
    },
    onSuccess: (count) =>
      queryClient.setQueryData<RowCount>(countKey, { count, exact: true, estimate: null }),
  });

  const metaQuery = useQuery({
    queryKey: ["query-result-meta", connection?.id, database, text, columns],
    queryFn: () => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return loadResultMeta({
        connection,
        database,
        text,
        columns,
        tables,
        foreignKeys: caps.foreign_keys,
      });
    },
    enabled: Boolean(connection),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const meta = metaQuery.data;

  const foreignKeys = useMemo(
    () => (meta ? resultForeignKeys(columns, meta.origins, meta.sources, text) : []),
    [meta, columns, text],
  );
  const columnDetails = useMemo(
    () => resultColumnDetails(columns, meta?.origins ?? [], meta?.types ?? [], meta?.sources ?? []),
    [meta, columns],
  );

  const data = rowsQuery.data;
  const { active: activeMasks } = useActiveMasks(data?.columns ?? []);
  const masked = activeMasks.length > 0;
  const rows = useMemo(() => {
    const source = data?.rows ?? [];
    return masked ? applyMasks(data?.columns ?? [], source, activeMasks, page) : source;
  }, [data, masked, activeMasks, page]);

  const totalCount = exactRowCount(countQuery.data);
  const approximate = approximateRowCount(countQuery.data);
  const countLabel = approximate && exactCount.isPending ? `${approximate} (zählt…)` : approximate;
  const handleExactCount =
    approximate && !exactCount.isPending
      ? () =>
          exactCount.mutate(undefined, {
            onError: (err) => toast.error(`Zählen fehlgeschlagen: ${String(err)}`),
          })
      : undefined;

  useEffect(() => {
    if (totalCount === undefined || rowsQuery.isFetching) return;
    const lastPage = Math.max(0, Math.ceil(totalCount / rowLimit) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [totalCount, rowsQuery.isFetching, rowLimit, page, setPage]);

  const handleFilterChange = (next: string, raw = true) => {
    setFilter(next);
    setFilterRaw(raw);
    setPage(0);
  };

  const { refetch } = rowsQuery;
  const handleRefresh = useMemo(
    () => async () => {
      const outcome = await refetch();
      void queryClient.invalidateQueries({ queryKey: countKey });
      if (outcome.error) throw outcome.error;
    },
    [refetch, queryClient, countKey],
  );

  const handleNavigateToTable = useMemo(
    () => (schema: string, table: string, filterWhere?: string, inTab?: boolean) => {
      if (!inTab) {
        useFkDrawerStack.getState().push({
          schema,
          table,
          filter: filterWhere,
          connectionId: scopedId,
        });
        return;
      }
      useFkDrawerStack.getState().clear();
      if (scopedId) {
        openScopedTable(scopedId, schema, table, filterWhere);
        return;
      }
      openTab({ schema, table, entityType: "table" });
      void appNavigate({
        to: "/tables/$schema/$table",
        params: { schema, table },
        search: filterWhere ? { fkFilter: filterWhere } : {},
      });
    },
    [openTab, appNavigate, scopedId],
  );

  return {
    connection,
    caps,
    stateKey,
    rowLimit,
    detailTab,
    setDetailTab,
    filter,
    filterRaw,
    sorting,
    setSorting,
    page,
    setPage,
    data,
    rows,
    masked,
    isLoading: rowsQuery.isLoading,
    isFetching: rowsQuery.isFetching,
    isError: rowsQuery.isError,
    error: rowsQuery.error,
    refetch,
    totalCount,
    countLabel,
    handleExactCount,
    foreignKeys,
    columnDetails,
    origins: meta?.origins ?? [],
    metaLoading: metaQuery.isLoading,
    handleFilterChange,
    handleRefresh,
    handleNavigateToTable,
  };
}

export type QueryResultViewModel = ReturnType<typeof useQueryResultViewModel>;
