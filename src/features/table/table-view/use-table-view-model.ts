import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConnectionScopeContext, useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { openScopedTable, useFkDrawerStack } from "@/lib/fk-drawer-stack";
import { useRedisRowEdit } from "@/lib/hooks/use-redis-row-edit";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { applyMasks } from "@/lib/masking";
import { useActiveMasks } from "@/lib/masking-display";
import {
  useDeleteRowMutation,
  useDetailedColumnsQuery,
  useExactRowCountMutation,
  useForeignKeysQuery,
  useInsertRowMutation,
  useTableRowCountQuery,
  useTableRowsWindow,
  useUpdateRowMutation,
  useViewsQuery,
} from "@/lib/queries";
import { approximateRowCount, exactRowCount } from "@/lib/row-count";
import { ROWS_WINDOW_MAX_EXTENT } from "@/lib/rows-window";
import { useSettingsStore } from "@/lib/settings";
import {
  availableTableDetailTabs,
  resolveTableDetailTab,
  type TableDetailTab,
} from "@/lib/table-detail-tabs";
import { useTableTabs } from "@/lib/table-tabs";
import { detailTabFor, tableViewStateKey, useTableViewStateStore } from "@/lib/table-view-state";
import { useWorkspacePane } from "@/lib/workspace-pane";
import type { TableViewProps } from "../table-view";

import { useTableExport } from "./use-table-export";

const routeApi = getRouteApi("/_app/_workspace/tables/$schema/$table");

export function useTableViewModel({
  schema,
  table,
  type,
  fkFilter,
  fkRaw,
  column,
  drawerId,
}: TableViewProps) {
  const routeNavigate = routeApi.useNavigate();
  const appNavigate = useNavigate();
  const pane = useWorkspacePane();
  const scopedId = useContext(ConnectionScopeContext);
  const inDrawer = drawerId !== undefined;
  const { data: views } = useViewsQuery();
  const { data: foreignKeys } = useForeignKeysQuery(schema, table);
  const tabEntityType = useTableTabs((state) => {
    const tab = state.tabs.find(
      (t) => t.kind === "table" && t.schema === schema && t.table === table,
    );
    return tab?.kind === "table" ? (tab.entityType ?? "table") : undefined;
  });
  const isView = useMemo(() => {
    if (type === "view") return true;
    if (views !== undefined) {
      return views.some((v) => v.schema === schema && v.name === table);
    }
    return tabEntityType === "view";
  }, [type, views, schema, table, tabEntityType]);
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const saveRedisRow = useRedisRowEdit();
  const openTab = useTableTabs((state) => state.openTab);
  const rowLimit = useSettingsStore((s) => s.rowLimit);
  const baseStateKey = tableViewStateKey(connection?.id, database, schema, table);
  const stateKey = inDrawer ? `${baseStateKey}:drawer:${drawerId}` : baseStateKey;
  const [localTab, setLocalTab] = useState<TableDetailTab>("data");
  const storedTab = useTableViewStateStore((s) => {
    if (!stateKey) return undefined;
    return inDrawer ? (s.views[stateKey]?.detailTab ?? "data") : detailTabFor(s, stateKey);
  });
  const selectedTab = storedTab ?? localTab;
  useEffect(() => {
    if (stateKey && !inDrawer) useTableViewStateStore.getState().keepDetailTab(stateKey);
  }, [stateKey, inDrawer]);
  const setDetailTab = useCallback(
    (tab: TableDetailTab) => {
      const store = useTableViewStateStore.getState();
      if (!stateKey) setLocalTab(tab);
      else if (inDrawer) store.patch(stateKey, { detailTab: tab });
      else store.selectDetailTab(stateKey, tab);
    },
    [stateKey, inDrawer],
  );
  const showDataTab = useCallback(() => {
    if (stateKey) useTableViewStateStore.getState().patch(stateKey, { detailTab: "data" });
    else setLocalTab("data");
  }, [stateKey]);
  const caps = useActiveCapabilities();
  const hiddenTabs = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const easyMode = useSettingsStore((s) => s.easyMode);
  const availableTabs = availableTableDetailTabs(isView, caps, easyMode);
  const visibleTabs = availableTabs.filter((tab) => !hiddenTabs.includes(tab.id));
  const viewTab = resolveTableDetailTab(selectedTab, visibleTabs);
  const tableTab = resolveTableDetailTab(selectedTab, visibleTabs);

  const [filter, setFilter] = useTableViewState(stateKey, "filter", "");
  const [filterRaw, setFilterRaw] = useTableViewState(stateKey, "filterRaw", false);
  const [sorting, setSorting] = useTableViewState(stateKey, "sorting", []);
  const [revealColumn, setRevealColumn] = useState<{ name: string; nonce: number } | null>(null);
  const [page, setPage] = useTableViewState(stateKey, "page", 0);
  const [addRowSignal, setAddRowSignal] = useState(0);
  const {
    columns: windowColumns,
    pages,
    rowOffset,
    rowExtent,
    onVisibleRowsChange,
    isLoading,
    isFetching,
    isError,
    error,
    refresh,
  } = useTableRowsWindow(schema, table, filter, sorting, isView, filterRaw, page, setPage);
  const data = useMemo(
    () =>
      windowColumns
        ? { columns: windowColumns, rows: pages.flatMap((entry) => entry.rows) }
        : undefined,
    [windowColumns, pages],
  );
  const { active: activeMasks } = useActiveMasks(data?.columns ?? []);
  const masked = activeMasks.length > 0;
  const pageRows = useMemo(() => {
    const cache = new WeakMap<object, Record<string, unknown>[]>();
    return (rows: Record<string, unknown>[], rowsPage: number) => {
      let out = cache.get(rows);
      if (out) return out;
      out =
        caps.query_language === "redis"
          ? rows.map((row) => ({ ...row, __ctid__: JSON.stringify(row.key) }))
          : rows;
      if (masked) out = applyMasks(windowColumns ?? [], out, activeMasks, rowsPage);
      cache.set(rows, out);
      return out;
    };
  }, [caps.query_language, masked, activeMasks, windowColumns]);
  const tableRows = useMemo(
    () => pages.flatMap((entry) => pageRows(entry.rows, entry.page)),
    [pages, pageRows],
  );
  const exportData = useMemo(
    () => (masked && data ? { columns: data.columns, rows: tableRows } : data),
    [masked, data, tableRows],
  );
  const refetch = useCallback(() => refresh().catch(() => undefined), [refresh]);
  const { data: rowCount } = useTableRowCountQuery(
    schema,
    table,
    filter,
    filterRaw,
    !isView || data !== undefined || isError,
  );
  const totalCount = exactRowCount(rowCount);
  const exactCount = useExactRowCountMutation(schema, table, filter, filterRaw);
  const approximate = approximateRowCount(rowCount);
  const gridTotal =
    totalCount !== undefined && totalCount > ROWS_WINDOW_MAX_EXTENT ? undefined : totalCount;
  const countLabel =
    approximate && exactCount.isPending
      ? `${approximate} (zählt…)`
      : (approximate ??
        (gridTotal === undefined && totalCount !== undefined
          ? totalCount.toLocaleString("de-DE")
          : undefined));
  const countExactly = exactCount.mutate;
  const handleExactCount = useMemo(
    () =>
      approximate && !exactCount.isPending
        ? () =>
            countExactly(undefined, {
              onError: (err) => toast.error(`Zählen fehlgeschlagen: ${String(err)}`),
            })
        : undefined,
    [approximate, exactCount.isPending, countExactly],
  );
  useEffect(() => {
    if (totalCount === undefined || isFetching) return;
    const lastPage = Math.max(0, Math.ceil(totalCount / rowLimit) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [totalCount, isFetching, rowLimit, page, setPage]);
  const { data: columnDetails } = useDetailedColumnsQuery(schema, table);
  const {
    exporting,
    csvExportOpen,
    setCsvExportOpen,
    xlsxExportOpen,
    dataExportFormat,
    setXlsxExportOpen,
    setDataExportFormat,
    exportColumns,
    exportRows,
    fullExportSource,
    handleExport,
  } = useTableExport({
    schema,
    table,
    filter,
    filterRaw,
    sorting,
    isView,
    totalCount,
    data: exportData,
    connection,
  });
  const updateRowMutation = useUpdateRowMutation(schema, table);
  const insertRowMutation = useInsertRowMutation(schema, table);
  const deleteRowMutation = useDeleteRowMutation(schema, table);

  const handleFilterChange = useCallback(
    (newFilter: string, raw = true) => {
      setFilter(newFilter);
      setFilterRaw(raw);
      setPage(0);
    },
    [setFilter, setFilterRaw, setPage],
  );
  const updateRow = updateRowMutation.mutateAsync;
  const saveRow = useCallback(
    async (
      ctid: string,
      updates: Record<string, string | null>,
      oldValues: Record<string, unknown>,
    ) => {
      await updateRow({ ctid, updates, oldValues });
    },
    [updateRow],
  );
  const insertRow = insertRowMutation.mutateAsync;
  const addRow = useCallback(
    async (values: Record<string, string | null>) => {
      await insertRow(values);
    },
    [insertRow],
  );

  const requestAddRow = () => setAddRowSignal((n) => n + 1);

  const deleteRow = deleteRowMutation.mutateAsync;
  const handleDeleteRow = useCallback(
    async (ctid: string, oldValues: Record<string, unknown>) => {
      try {
        await deleteRow({ ctid, oldValues });
        toast.success("Zeile gelöscht.");
      } catch (err) {
        toast.error(typeof err === "string" ? err : String(err));
      }
    },
    [deleteRow],
  );

  const handleRefresh = refresh;

  const handleNavigateToTable = useMemo(() => {
    return (targetSchema: string, targetTable: string, filterWhere?: string, inTab?: boolean) => {
      if (!inTab) {
        useFkDrawerStack.getState().push({
          schema: targetSchema,
          table: targetTable,
          filter: filterWhere,
          connectionId: scopedId,
        });
        return;
      }
      useFkDrawerStack.getState().clear();
      if (scopedId) {
        openScopedTable(scopedId, targetSchema, targetTable, filterWhere);
        return;
      }
      openTab({ schema: targetSchema, table: targetTable, entityType: "table" });
      void appNavigate({
        to: "/tables/$schema/$table",
        params: { schema: targetSchema, table: targetTable },
        search: filterWhere ? { fkFilter: filterWhere } : {},
      });
    };
  }, [openTab, appNavigate, scopedId]);

  useEffect(() => {
    if (inDrawer || pane) return;
    openTab({ schema, table, entityType: isView ? "view" : "table" });
  }, [schema, table, isView, openTab, inDrawer, pane]);

  useEffect(() => {
    if (inDrawer) return;
    if (!isView || type === "view" || scopedId || (pane && !pane.focused)) return;
    void routeNavigate({
      search: { type: "view" },
      replace: true,
    });
  }, [isView, type, routeNavigate, pane, inDrawer, scopedId]);

  useEffect(() => {
    if (fkFilter === undefined) return;
    setFilter(fkFilter);
    setFilterRaw(fkRaw ?? false);
    setSorting([]);
    setPage(0);
    showDataTab();
    if (inDrawer) return;
    void routeNavigate({
      search: (previous) => ({ ...previous, fkFilter: undefined, fkRaw: undefined }),
      replace: true,
    });
  }, [
    fkFilter,
    fkRaw,
    routeNavigate,
    setFilter,
    setFilterRaw,
    setSorting,
    setPage,
    showDataTab,
    inDrawer,
  ]);

  useEffect(() => {
    if (column && !isLoading) setRevealColumn({ name: column, nonce: Date.now() });
  }, [column, isLoading]);

  return {
    inDrawer,
    isView,
    connection,
    database,
    saveRedisRow,
    rowLimit,
    stateKey,
    caps,
    availableTabs,
    viewTab,
    tableTab,
    tableRows,
    rowOffset,
    rowExtent,
    onVisibleRowsChange,
    masked,
    insertRowMutation,
    saveRow,
    addRow,
    handleFilterChange,
    requestAddRow,
    handleDeleteRow,
    handleRefresh,
    handleNavigateToTable,
    foreignKeys,
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    totalCount: gridTotal,
    countLabel,
    handleExactCount,
    columnDetails,
    exporting,
    csvExportOpen,
    setCsvExportOpen,
    xlsxExportOpen,
    dataExportFormat,
    setXlsxExportOpen,
    setDataExportFormat,
    exportColumns,
    exportRows,
    fullExportSource,
    handleExport,
    setDetailTab,
    filter,
    filterRaw,
    sorting,
    setSorting,
    revealColumn,
    page,
    setPage,
    addRowSignal,
  };
}
