import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { useFkDrawerStack } from "@/lib/fk-drawer-stack";
import { useRedisRowEdit } from "@/lib/hooks/use-redis-row-edit";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import {
  useDeleteRowMutation,
  useDetailedColumnsQuery,
  useForeignKeysQuery,
  useInsertRowMutation,
  useTableRowCountQuery,
  useTableRowsQuery,
  useUpdateRowMutation,
  useViewsQuery,
} from "@/lib/queries";
import { describeInsertError } from "@/lib/row-duplicate";
import { useSettingsStore } from "@/lib/settings";
import { availableTableDetailTabs, resolveTableDetailTab } from "@/lib/table-detail-tabs";
import { useTableTabs } from "@/lib/table-tabs";
import { tableViewStateKey } from "@/lib/table-view-state";
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
  const [selectedTab, setDetailTab] = useTableViewState(stateKey, "detailTab", "data");
  const caps = useActiveCapabilities();
  const hiddenTabs = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const availableTabs = availableTableDetailTabs(isView, caps);
  const visibleTabs = availableTabs.filter((tab) => !hiddenTabs.includes(tab.id));
  const viewTab = resolveTableDetailTab(selectedTab, visibleTabs);
  const tableTab = resolveTableDetailTab(selectedTab, visibleTabs);

  useEffect(() => {
    if (isView && viewTab) setDetailTab(viewTab);
    if (!isView && tableTab) setDetailTab(tableTab);
  }, [isView, viewTab, tableTab, setDetailTab]);
  const [filter, setFilter] = useTableViewState(stateKey, "filter", "");
  const [filterRaw, setFilterRaw] = useTableViewState(stateKey, "filterRaw", false);
  const [sorting, setSorting] = useTableViewState(stateKey, "sorting", []);
  const [revealColumn, setRevealColumn] = useState<{ name: string; nonce: number } | null>(null);
  const [page, setPage] = useTableViewState(stateKey, "page", 0);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const { data, isLoading, isFetching, isError, error, refetch } = useTableRowsQuery(
    schema,
    table,
    filter,
    sorting,
    isView,
    page,
    filterRaw,
  );
  const tableRows = useMemo(
    () =>
      caps.query_language === "redis"
        ? (data?.rows ?? []).map((row) => ({ ...row, __ctid__: JSON.stringify(row.key) }))
        : (data?.rows ?? []),
    [data?.rows, caps.query_language],
  );
  const { data: totalCount } = useTableRowCountQuery(
    schema,
    table,
    filter,
    filterRaw,
    !isView || data !== undefined || isError,
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
    setXlsxExportOpen,
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
    data,
    connection,
  });
  const updateRowMutation = useUpdateRowMutation(schema, table);
  const insertRowMutation = useInsertRowMutation(schema, table);
  const deleteRowMutation = useDeleteRowMutation(schema, table);

  const handleFilterChange = (newFilter: string, raw = true) => {
    setFilter(newFilter);
    setFilterRaw(raw);
    setPage(0);
  };

  const handleInsertRow = async (values: Record<string, string | null>) => {
    try {
      await insertRowMutation.mutateAsync(values);
      toast.success("Neue Zeile hinzugefügt.");
      setInsertError(null);
      setAddRowOpen(false);
    } catch (err) {
      const message = describeInsertError(err);
      setInsertError(message);
      toast.error(message);
    }
  };

  const handleRowDialogOpenChange = (open: boolean) => {
    setAddRowOpen(open);
    if (!open) {
      setInsertError(null);
    }
  };

  const handleDeleteRow = async (ctid: string, oldValues: Record<string, unknown>) => {
    try {
      await deleteRowMutation.mutateAsync({ ctid, oldValues });
      toast.success("Zeile gelöscht.");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  const handleRefresh = useMemo(() => {
    return async () => {
      const result = await refetch();
      if (result.error) throw result.error;
    };
  }, [refetch]);

  const handleNavigateToTable = useMemo(() => {
    return (targetSchema: string, targetTable: string, filterWhere?: string, inTab?: boolean) => {
      if (!inTab) {
        useFkDrawerStack
          .getState()
          .push({ schema: targetSchema, table: targetTable, filter: filterWhere });
        return;
      }
      useFkDrawerStack.getState().clear();
      openTab({ schema: targetSchema, table: targetTable, entityType: "table" });
      void appNavigate({
        to: "/tables/$schema/$table",
        params: { schema: targetSchema, table: targetTable },
        search: filterWhere ? { fkFilter: filterWhere } : {},
      });
    };
  }, [openTab, appNavigate]);

  useEffect(() => {
    if (inDrawer) return;
    openTab({ schema, table, entityType: isView ? "view" : "table" });
  }, [schema, table, isView, openTab, inDrawer]);

  useEffect(() => {
    if (inDrawer) return;
    if (!isView || type === "view" || (pane && !pane.focused)) return;
    void routeNavigate({
      search: { type: "view" },
      replace: true,
    });
  }, [isView, type, routeNavigate, pane, inDrawer]);

  useEffect(() => {
    if (fkFilter === undefined) return;
    setFilter(fkFilter);
    setFilterRaw(fkRaw ?? false);
    setSorting([]);
    setPage(0);
    setDetailTab("data");
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
    setDetailTab,
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
    updateRowMutation,
    insertRowMutation,
    handleFilterChange,
    handleInsertRow,
    handleRowDialogOpenChange,
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
    totalCount,
    columnDetails,
    exporting,
    csvExportOpen,
    setCsvExportOpen,
    xlsxExportOpen,
    setXlsxExportOpen,
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
    setRevealColumn,
    page,
    setPage,
    addRowOpen,
    setAddRowOpen,
    insertError,
    setInsertError,
  };
}
