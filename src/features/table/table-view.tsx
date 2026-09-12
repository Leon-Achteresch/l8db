import { useHotkey } from "@tanstack/react-hotkeys";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { DownloadIcon, FilterXIcon, LoaderIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { XlsxExportDialog } from "@/features/export/xlsx-export-dialog";
import { ObjectAdminMenu } from "@/features/object-admin/object-admin-menu";
import { ObjectAuditPanel } from "@/features/object-admin/object-audit-panel";
import { DataTable } from "@/features/table/data-table";
import { NewRowDialog } from "@/features/table/new-row-dialog";
import { RedisKeyActions } from "@/features/table/redis-key-actions";
import { TableColumnsList } from "@/features/table/table-columns-list";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { TableDetailTabBar } from "@/features/table/table-detail-tab-bar";
import { TableFilterPanel } from "@/features/table/table-filter-panel";
import { TableIndexesList } from "@/features/table/table-indexes-list";
import { TablePartitionsPanel } from "@/features/table/table-partitions-panel";

import { TableRlsPanel } from "@/features/table/table-rls-panel";
import { TableTriggersList } from "@/features/table/table-triggers-list";
import { TableUsedByPanel } from "@/features/table/table-used-by-panel";
import { TableViewsPanel } from "@/features/table/table-views-panel";

import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { buildInsertStatements, UnsupportedValueError } from "@/lib/export";
import { useRedisRowEdit } from "@/lib/hooks/use-redis-row-edit";
import { onHotkeyAction, useResolvedHotkey } from "@/lib/hotkeys";
import {
  useDeleteRowMutation,
  useDetailedColumnsQuery,
  useDuplicateRowMutation,
  useForeignKeysQuery,
  useInsertRowMutation,
  useTableRowCountQuery,
  useTableRowsQuery,
  useUpdateRowMutation,
  useViewsQuery,
} from "@/lib/queries";
import { canEditRedisCell, REDIS_KEY_FILTER_OPERATORS, redisKeyFilter } from "@/lib/redis-commands";
import type { DuplicatePrefill } from "@/lib/row-duplicate";
import { buildDuplicatePrefill, describeInsertError } from "@/lib/row-duplicate";
import { useSettingsStore } from "@/lib/settings";
import {
  availableTableDetailTabs,
  resolveTableDetailTab,
  type TableDetailTab,
} from "@/lib/table-detail-tabs";
import { useTableTabs } from "@/lib/table-tabs";
import { useWorkspacePane } from "@/lib/workspace-pane";

const ViewDefinitionPanel = lazy(() =>
  import("@/features/table/view-definition-panel").then((module) => ({
    default: module.ViewDefinitionPanel,
  })),
);
const TablePerfPanel = lazy(() =>
  import("@/features/table/table-perf-panel").then((module) => ({
    default: module.TablePerfPanel,
  })),
);

const routeApi = getRouteApi("/_app/_workspace/tables/$schema/$table");

export interface TableViewProps {
  schema: string;
  table: string;
  type?: "table" | "view";
  fkFilter?: string;
  fkRaw?: boolean;
  column?: string;
}

export function TableView({ schema, table, type, fkFilter, fkRaw, column }: TableViewProps) {
  const navigate = useNavigate();
  const routeNavigate = routeApi.useNavigate();
  const pane = useWorkspacePane();
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
  const [selectedViewTab, setViewTab] = useState<TableDetailTab>("data");
  const [selectedTableTab, setTableTab] = useState<TableDetailTab>("data");
  const caps = useActiveCapabilities();
  const hiddenTabs = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const availableTabs = availableTableDetailTabs(isView, caps);
  const visibleTabs = availableTabs.filter((tab) => !hiddenTabs.includes(tab.id));
  const viewTab = resolveTableDetailTab(selectedViewTab, visibleTabs);
  const tableTab = resolveTableDetailTab(selectedTableTab, visibleTabs);

  useEffect(() => {
    if (isView && viewTab) setViewTab(viewTab);
    if (!isView && tableTab) setTableTab(tableTab);
  }, [isView, viewTab, tableTab]);
  const [filter, setFilter] = useState(fkFilter ?? "");
  const [filterRaw, setFilterRaw] = useState(fkRaw ?? false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [revealColumn, setRevealColumn] = useState<{ name: string; nonce: number } | null>(null);
  const [page, setPage] = useState(0);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [duplicatePrefill, setDuplicatePrefill] = useState<DuplicatePrefill | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [xlsxExportOpen, setXlsxExportOpen] = useState(false);
  const gridExportHotkey = useResolvedHotkey("grid.export");
  useHotkey(
    gridExportHotkey,
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      setCsvExportOpen(true);
    },
    { ignoreInputs: false },
  );
  useEffect(() => onHotkeyAction("grid.export", () => setCsvExportOpen(true)), []);
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
  const { data: totalCount } = useTableRowCountQuery(schema, table, filter, filterRaw);
  const { data: columnDetails } = useDetailedColumnsQuery(schema, table);
  const updateRowMutation = useUpdateRowMutation(schema, table);
  const insertRowMutation = useInsertRowMutation(schema, table);
  const duplicateRowMutation = useDuplicateRowMutation(schema, table);
  const deleteRowMutation = useDeleteRowMutation(schema, table);

  const handleFilterChange = (newFilter: string, raw = true) => {
    setFilter(newFilter);
    setFilterRaw(raw);
    setPage(0);
  };

  const handleInsertRow = async (values: Record<string, string | null>) => {
    const wasDuplicate = duplicatePrefill !== null;
    try {
      await insertRowMutation.mutateAsync(values);
      toast.success(wasDuplicate ? "Zeile als neue Zeile eingefügt." : "Neue Zeile hinzugefügt.");
      setInsertError(null);
      setDuplicatePrefill(null);
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
      setDuplicatePrefill(null);
    }
  };

  const handleDuplicateRowToEdit = (_ctid: string, values: Record<string, unknown>) => {
    setInsertError(null);
    setDuplicatePrefill(buildDuplicatePrefill(data?.columns ?? [], values, columnDetails));
    setAddRowOpen(true);
  };

  const handleDuplicateRow = async (ctid: string) => {
    try {
      await duplicateRowMutation.mutateAsync(ctid);
      toast.success("Zeile dupliziert.");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
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

  const exportColumns = useMemo(
    () => (data?.columns ?? []).filter((c) => c !== "__ctid__"),
    [data],
  );

  const getExportRows = useCallback(() => {
    const cols = exportColumns;
    return (data?.rows ?? []).map((row) => {
      const source = row as Record<string, unknown>;
      const obj: Record<string, unknown> = {};
      for (const c of cols) obj[c] = source[c] ?? null;
      return obj;
    });
  }, [data, exportColumns]);
  const exportRows = useMemo(
    () => (csvExportOpen || xlsxExportOpen ? getExportRows() : []),
    [csvExportOpen, xlsxExportOpen, getExportRows],
  );

  const fullExportSource = useMemo(
    () => ({
      schema,
      table,
      filter,
      filterRaw,
      orderBy: sorting[0]?.id ?? null,
      orderDesc: sorting[0]?.desc ?? false,
      isView,
      totalRows: totalCount ?? null,
    }),
    [schema, table, filter, filterRaw, sorting, isView, totalCount],
  );

  const handleExport = async (format: "json" | "sql") => {
    if (!data) return;
    setExporting(true);
    try {
      const exportRows = getExportRows();
      const ext = format === "json" ? "json" : "sql";
      let content: string;
      if (format === "json") {
        content = JSON.stringify(exportRows, null, 2);
      } else {
        content = buildInsertStatements({
          schema,
          table,
          columns: exportColumns,
          rows: exportRows,
          kind: connection?.kind,
        });
      }
      const filePath = await save({
        defaultPath: `${table}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, content);
      toast.success(`Exportiert nach ${filePath.split("/").pop()}`);
    } catch (err) {
      if (err instanceof UnsupportedValueError) {
        toast.error(`Export abgebrochen – ${err.message}`);
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setExporting(false);
    }
  };

  const handleRefresh = useMemo(() => {
    return async () => {
      const result = await refetch();
      if (result.error) throw result.error;
    };
  }, [refetch]);

  const handleNavigateToTable = useMemo(() => {
    return (targetSchema: string, targetTable: string, filterWhere?: string) => {
      openTab({ schema: targetSchema, table: targetTable, entityType: "table" });
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: targetSchema, table: targetTable },
        search: filterWhere ? { fkFilter: filterWhere } : {},
      });
    };
  }, [openTab, navigate]);

  useEffect(() => {
    openTab({ schema, table, entityType: isView ? "view" : "table" });
  }, [schema, table, isView, openTab]);

  useEffect(() => {
    if (!isView || type === "view" || (pane && !pane.focused)) return;
    void routeNavigate({
      search: { type: "view" },
      replace: true,
    });
  }, [isView, type, routeNavigate]);

  useEffect(() => {
    setFilter(fkFilter ?? "");
    setFilterRaw(fkRaw ?? false);
    setSorting([]);
    setPage(0);
    setViewTab("data");
    setTableTab("data");
  }, [schema, table, fkFilter, fkRaw]);

  useEffect(() => {
    if (column && !isLoading) setRevealColumn({ name: column, nonce: Date.now() });
  }, [column, isLoading]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  const emptyMessage = filter.trim() === "" ? "Keine Daten." : "Keine Zeilen für diesen Filter.";

  const dataContent = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {!isView && (
        <>
          <TableViewsPanel
            schema={schema}
            table={table}
            activeFilter={filter}
            onSelectView={handleFilterChange}
          />
          <div
            className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden"
            data-tour="table-filter"
          >
            <TableFilterPanel
              key={`${schema}.${table}`}
              columns={data?.columns ?? []}
              columnDetails={columnDetails}
              activeFilter={filter}
              onApply={handleFilterChange}
              onColumnSelect={(name) => setRevealColumn({ name, nonce: Date.now() })}
            />
          </div>
        </>
      )}
      {isLoading ? (
        <TableDataSkeleton />
      ) : isError ? (
        <TableDataError
          title="Fehler beim Laden der Tabelle"
          error={error}
          actions={
            <>
              {(filter.trim() !== "" || sorting.length > 0) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    handleFilterChange("", false);
                    setSorting([]);
                  }}
                >
                  <FilterXIcon />
                  Filter & Sortierung zurücksetzen
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void refetch()}>
                <RefreshCwIcon />
                Erneut versuchen
              </Button>
            </>
          }
        />
      ) : (
        <DataTable
          className="h-full min-h-0 flex-1"
          columns={data?.columns ?? []}
          data={tableRows}
          emptyMessage={emptyMessage}
          sorting={sorting}
          sortableColumns={caps.query_language === "redis" ? ["key"] : undefined}
          onSortingChange={setSorting}
          isFetching={isFetching}
          onSaveRow={
            caps.query_language === "redis"
              ? connection?.readOnly
                ? undefined
                : saveRedisRow
              : isView || !caps.row_edit
                ? undefined
                : async (ctid, updates, oldValues) => {
                    await updateRowMutation.mutateAsync({ ctid, updates, oldValues });
                  }
          }
          canEditCell={caps.query_language === "redis" ? canEditRedisCell : undefined}
          cellEditorKind={caps.query_language === "redis" ? "text" : undefined}
          emptyEditValue={caps.query_language === "redis" ? "" : undefined}
          filterableColumns={caps.query_language === "redis" ? ["key"] : undefined}
          compileColumnFilter={caps.query_language === "redis" ? redisKeyFilter : undefined}
          filterOperators={caps.query_language === "redis" ? REDIS_KEY_FILTER_OPERATORS : undefined}
          filterPrefix={
            caps.query_language === "redis"
              ? "MATCH"
              : caps.query_language === "json"
                ? "JSON"
                : undefined
          }
          onApplyFilter={handleFilterChange}
          revealColumn={revealColumn}
          page={page}
          totalCount={totalCount ?? undefined}
          pageSize={rowLimit}
          onPageChange={setPage}
          foreignKeys={foreignKeys}
          currentSchema={schema}
          currentTable={table}
          onNavigateToTable={handleNavigateToTable}
          onDuplicateRow={isView || !caps.row_edit ? undefined : handleDuplicateRow}
          onDuplicateRowToEdit={isView || !caps.row_edit ? undefined : handleDuplicateRowToEdit}
          onDeleteRow={isView || !caps.row_edit ? undefined : handleDeleteRow}
          columnDetails={columnDetails}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );

  if (isView) {
    return (
      <Tabs
        value={viewTab}
        onValueChange={(v) => setViewTab(v as TableDetailTab)}
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          className="flex shrink-0 items-center border-b bg-muted/30 px-3"
          data-tour="table-toolbar"
        >
          <TableDetailTabBar tabs={availableTabs} />
          <div className="ml-auto flex items-center gap-1">
            <ObjectAdminMenu schema={schema} name={table} objectType="view" showAlter={false} />
            {viewTab === "data" && data && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    disabled={exporting}
                  >
                    {exporting ? (
                      <LoaderIcon className="size-3.5 animate-spin" />
                    ) : (
                      <DownloadIcon className="size-3.5" />
                    )}
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setCsvExportOpen(true)}>
                    Als CSV exportieren…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setXlsxExportOpen(true)}>
                    Als XLSX exportieren…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleExport("json")}>
                    Als JSON exportieren
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleExport("sql")}>
                    Als INSERT-SQL exportieren
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {dataContent}
        </TabsContent>

        <TabsContent value="columns" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TableColumnsList schema={schema} table={table} />
        </TabsContent>

        <TabsContent value="definition" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <div role="status" className="p-4 text-sm text-muted-foreground">
                Ansicht wird geladen…
              </div>
            }
          >
            <ViewDefinitionPanel schema={schema} view={table} />
          </Suspense>
        </TabsContent>

        <TabsContent value="used-by" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TableUsedByPanel schema={schema} name={table} />
        </TabsContent>

        <TabsContent value="performance" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {caps.explain && (
            <Suspense
              fallback={
                <div role="status" className="p-4 text-sm text-muted-foreground">
                  Ansicht wird geladen…
                </div>
              }
            >
              <TablePerfPanel schema={schema} table={table} filter={filter} isView={true} />
            </Suspense>
          )}
        </TabsContent>

        <TabsContent value="audit" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {caps.object_admin && <ObjectAuditPanel schema={schema} name={table} objectType="view" />}
        </TabsContent>

        <CsvExportDialog
          open={csvExportOpen}
          onOpenChange={setCsvExportOpen}
          columns={exportColumns}
          rows={exportRows}
          defaultFileName={`${table}.csv`}
          fullExport={fullExportSource}
        />
        <XlsxExportDialog
          open={xlsxExportOpen}
          onOpenChange={setXlsxExportOpen}
          columns={exportColumns}
          rows={exportRows}
          defaultFileName={`${table}.xlsx`}
          defaultSheetName={table}
        />
      </Tabs>
    );
  }

  return (
    <Tabs
      value={tableTab}
      onValueChange={(v) => setTableTab(v as TableDetailTab)}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        className="flex shrink-0 items-center border-b bg-muted/30 px-3"
        data-tour="table-toolbar"
      >
        <TableDetailTabBar tabs={availableTabs} />
        <div className="ml-auto flex items-center gap-1">
          <ObjectAdminMenu schema={schema} name={table} objectType="table" />
          {tableTab === "data" && caps.query_language === "redis" && (
            <RedisKeyActions key={`${connection?.id}:${database}`} />
          )}
          {tableTab === "data" && caps.row_edit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2.5 text-xs"
              data-tour="table-add"
              onClick={() => {
                setInsertError(null);
                setDuplicatePrefill(null);
                setAddRowOpen(true);
              }}
              disabled={insertRowMutation.isPending}
            >
              <PlusIcon className="size-3.5" />
              Neue Zeile
            </Button>
          )}
          {tableTab === "data" && data && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  disabled={exporting}
                >
                  {exporting ? (
                    <LoaderIcon className="size-3.5 animate-spin" />
                  ) : (
                    <DownloadIcon className="size-3.5" />
                  )}
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCsvExportOpen(true)}>
                  Als CSV exportieren…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setXlsxExportOpen(true)}>
                  Als XLSX exportieren…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleExport("json")}>
                  Als JSON exportieren
                </DropdownMenuItem>
                {caps.query_language !== "redis" && caps.query_language !== "json" && (
                  <DropdownMenuItem onClick={() => void handleExport("sql")}>
                    Als INSERT-SQL exportieren
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {caps.query_language === "redis" && (
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
            Key, TTL und vollständige Strings per Doppelklick bearbeiten. Keys per Rechtsklick auf
            den Spaltenkopf filtern. Sammlungen und gekürzte Werte unter „Key verwalten“ lesen und
            ändern. Vorschau: bis zu 100 Einträge bzw. 4 KiB; size zeigt die Gesamtgröße.
          </p>
        )}
        {dataContent}
      </TabsContent>

      <TabsContent value="columns" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableColumnsList schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="triggers" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableTriggersList schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="indexes" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableIndexesList schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="rls" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableRlsPanel schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="partitions" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TablePartitionsPanel schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="used-by" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableUsedByPanel schema={schema} name={table} />
      </TabsContent>

      <TabsContent value="performance" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {caps.explain && (
          <Suspense
            fallback={
              <div role="status" className="p-4 text-sm text-muted-foreground">
                Ansicht wird geladen…
              </div>
            }
          >
            <TablePerfPanel schema={schema} table={table} filter={filter} isView={false} />
          </Suspense>
        )}
      </TabsContent>

      <TabsContent value="audit" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {caps.object_admin && <ObjectAuditPanel schema={schema} name={table} objectType="table" />}
      </TabsContent>

      <NewRowDialog
        open={addRowOpen}
        onOpenChange={handleRowDialogOpenChange}
        schema={schema}
        table={table}
        columns={data?.columns ?? []}
        isPending={insertRowMutation.isPending}
        onSubmit={handleInsertRow}
        prefill={duplicatePrefill}
        errorMessage={insertError}
      />

      <CsvExportDialog
        open={csvExportOpen}
        onOpenChange={setCsvExportOpen}
        columns={exportColumns}
        rows={exportRows}
        defaultFileName={`${table}.csv`}
        fullExport={fullExportSource}
      />
      <XlsxExportDialog
        open={xlsxExportOpen}
        onOpenChange={setXlsxExportOpen}
        columns={exportColumns}
        rows={exportRows}
        defaultFileName={`${table}.xlsx`}
        defaultSheetName={table}
      />
    </Tabs>
  );
}
