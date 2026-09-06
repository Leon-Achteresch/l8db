import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  CodeIcon,
  Columns2Icon,
  DownloadIcon,
  LayersIcon,
  LoaderIcon,
  NetworkIcon,
  PlusIcon,
  ShieldIcon,
  TableIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { DataTable } from "@/features/table/data-table";
import { NewRowDialog } from "@/features/table/new-row-dialog";
import { TableColumnsList } from "@/features/table/table-columns-list";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { TableFilterPanel } from "@/features/table/table-filter-panel";
import { TableIndexesList } from "@/features/table/table-indexes-list";
import { TablePartitionsPanel } from "@/features/table/table-partitions-panel";
import { TableRlsPanel } from "@/features/table/table-rls-panel";
import { TableTriggersList } from "@/features/table/table-triggers-list";
import { TableViewsPanel } from "@/features/table/table-views-panel";
import { ViewDefinitionPanel } from "@/features/table/view-definition-panel";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { buildInsertStatements, UnsupportedValueError } from "@/lib/export";
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
import type { DuplicatePrefill } from "@/lib/row-duplicate";
import { buildDuplicatePrefill, describeInsertError } from "@/lib/row-duplicate";
import { useSettingsStore } from "@/lib/settings";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/_workspace/tables/$schema/$table");

type ViewTab = "data" | "definition" | "columns";
type TableTab = "data" | "triggers" | "columns" | "indexes" | "rls" | "partitions";

export function TableView() {
  const { schema, table } = routeApi.useParams();
  const { type, fkFilter, fkRaw } = routeApi.useSearch();
  const navigate = useNavigate();
  const routeNavigate = routeApi.useNavigate();
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
  const openTab = useTableTabs((state) => state.openTab);
  const rowLimit = useSettingsStore((s) => s.rowLimit);
  const [viewTab, setViewTab] = useState<ViewTab>("data");
  const [tableTab, setTableTab] = useState<TableTab>("data");
  const caps = useActiveCapabilities();
  const [filter, setFilter] = useState(fkFilter ?? "");
  const [filterRaw, setFilterRaw] = useState(fkRaw ?? false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [duplicatePrefill, setDuplicatePrefill] = useState<DuplicatePrefill | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const { data, isLoading, isFetching, isError, error, refetch } = useTableRowsQuery(
    schema,
    table,
    filter,
    sorting,
    isView,
    page,
    filterRaw,
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

  const exportRows = useMemo(() => {
    const cols = exportColumns;
    return (data?.rows ?? []).map((row) => {
      const source = row as Record<string, unknown>;
      const obj: Record<string, unknown> = {};
      for (const c of cols) obj[c] = source[c] ?? null;
      return obj;
    });
  }, [data, exportColumns]);

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
    if (!isView || type === "view") return;
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

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  const emptyMessage = filter.trim() === "" ? "Keine Daten." : "Keine Zeilen für diesen Filter.";

  const dataContent = isLoading ? (
    <TableDataSkeleton />
  ) : isError ? (
    <TableDataError title="Fehler beim Laden der Tabelle" error={error} />
  ) : (
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
              activeFilter={filter}
              onApply={handleFilterChange}
            />
          </div>
        </>
      )}
      <DataTable
        className="h-full min-h-0 flex-1"
        columns={data?.columns ?? []}
        data={data?.rows ?? []}
        emptyMessage={emptyMessage}
        sorting={sorting}
        onSortingChange={setSorting}
        isFetching={isFetching}
        onSaveRow={
          isView || !caps.row_edit
            ? undefined
            : async (ctid, updates, oldValues) => {
                await updateRowMutation.mutateAsync({ ctid, updates, oldValues });
              }
        }
        onApplyFilter={handleFilterChange}
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
    </div>
  );

  if (isView) {
    return (
      <Tabs
        value={viewTab}
        onValueChange={(v) => setViewTab(v as ViewTab)}
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          className="flex shrink-0 items-center border-b bg-muted/30 px-3"
          data-tour="table-toolbar"
        >
          <TabsList variant="line" className="h-9">
            <TabsTrigger value="data">
              <TableIcon className="size-3.5" />
              Daten
            </TabsTrigger>
            <TabsTrigger value="columns">
              <Columns2Icon className="size-3.5" />
              Columns
            </TabsTrigger>
            <TabsTrigger value="definition">
              <CodeIcon className="size-3.5" />
              Definition
            </TabsTrigger>
          </TabsList>
          {viewTab === "data" && data && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
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

        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {dataContent}
        </TabsContent>

        <TabsContent value="columns" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TableColumnsList schema={schema} table={table} />
        </TabsContent>

        <TabsContent value="definition" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ViewDefinitionPanel schema={schema} view={table} />
        </TabsContent>
        <CsvExportDialog
          open={csvExportOpen}
          onOpenChange={setCsvExportOpen}
          columns={exportColumns}
          rows={exportRows}
          defaultFileName={`${table}.csv`}
          fullExport={fullExportSource}
        />
      </Tabs>
    );
  }

  return (
    <Tabs
      value={tableTab}
      onValueChange={(v) => setTableTab(v as TableTab)}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        className="flex shrink-0 items-center border-b bg-muted/30 px-3"
        data-tour="table-toolbar"
      >
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="data">
            <TableIcon className="size-3.5" />
            Daten
          </TabsTrigger>
          <TabsTrigger value="columns">
            <Columns2Icon className="size-3.5" />
            Columns
          </TabsTrigger>
          {caps.triggers && (
            <TabsTrigger value="triggers">
              <ZapIcon className="size-3.5" />
              Trigger
            </TabsTrigger>
          )}
          {caps.indexes && (
            <TabsTrigger value="indexes">
              <LayersIcon className="size-3.5" />
              Indexes
            </TabsTrigger>
          )}
          {caps.rls && (
            <TabsTrigger value="rls">
              <ShieldIcon className="size-3.5" />
              RLS
            </TabsTrigger>
          )}
          {caps.partitions && (
            <TabsTrigger value="partitions">
              <NetworkIcon className="size-3.5" />
              Partitionen
            </TabsTrigger>
          )}
        </TabsList>
        <div className="ml-auto flex items-center gap-1">
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
    </Tabs>
  );
}
