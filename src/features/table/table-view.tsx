import { useEffect, useMemo, useState } from "react";

import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { CodeIcon, Columns2Icon, PlusIcon, TableIcon, ZapIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/features/table/data-table";
import { NewRowDialog } from "@/features/table/new-row-dialog";
import { TableColumnsList } from "@/features/table/table-columns-list";
import { TableFilterPanel } from "@/features/table/table-filter-panel";
import { TableTriggersList } from "@/features/table/table-triggers-list";
import { TableViewsPanel } from "@/features/table/table-views-panel";
import { ViewDefinitionPanel } from "@/features/table/view-definition-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { useActiveConnection } from "@/lib/connections";
import {
  useTableRowsQuery,
  useTableRowCountQuery,
  useUpdateRowMutation,
  useInsertRowMutation,
  useDuplicateRowMutation,
  useDeleteRowMutation,
  useViewsQuery,
  useForeignKeysQuery,
  PAGE_SIZE,
} from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/tables/$schema/$table");

type ViewTab = "data" | "definition" | "columns";
type TableTab = "data" | "triggers" | "columns";

export function TableView() {
  const { schema, table } = routeApi.useParams();
  const { type, fkFilter } = routeApi.useSearch();
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
  const [viewTab, setViewTab] = useState<ViewTab>("data");
  const [tableTab, setTableTab] = useState<TableTab>("data");
  const [filter, setFilter] = useState(fkFilter ?? "");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const { data, isLoading, isFetching, isError, error } = useTableRowsQuery(
    schema,
    table,
    filter,
    sorting,
    isView,
    page,
  );
  const { data: totalCount } = useTableRowCountQuery(schema, table, filter);
  const updateRowMutation = useUpdateRowMutation(schema, table);
  const insertRowMutation = useInsertRowMutation(schema, table);
  const duplicateRowMutation = useDuplicateRowMutation(schema, table);
  const deleteRowMutation = useDeleteRowMutation(schema, table);

  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter);
    setPage(0);
  };

  const handleInsertRow = async (values: Record<string, string | null>) => {
    try {
      await insertRowMutation.mutateAsync(values);
      toast.success("Neue Zeile hinzugefügt.");
      setAddRowOpen(false);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  const handleDuplicateRow = async (ctid: string) => {
    try {
      await duplicateRowMutation.mutateAsync(ctid);
      toast.success("Zeile dupliziert.");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  const handleDeleteRow = async (
    ctid: string,
    oldValues: Record<string, unknown>,
  ) => {
    try {
      await deleteRowMutation.mutateAsync({ ctid, oldValues });
      toast.success("Zeile gelöscht.");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

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
    setSorting([]);
    setPage(0);
    setViewTab("data");
    setTableTab("data");
  }, [schema, table, fkFilter]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  const emptyMessage =
    filter.trim() === ""
      ? "Keine Daten."
      : "Keine Zeilen für diesen Filter.";

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
          <div className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden">
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
          isView
            ? undefined
            : async (ctid, updates, oldValues) => {
                await updateRowMutation.mutateAsync({ ctid, updates, oldValues });
              }
        }
        onApplyFilter={handleFilterChange}
        page={page}
        totalCount={totalCount ?? undefined}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        foreignKeys={foreignKeys}
        currentSchema={schema}
        currentTable={table}
        onNavigateToTable={handleNavigateToTable}
        onDuplicateRow={isView ? undefined : handleDuplicateRow}
        onDeleteRow={isView ? undefined : handleDeleteRow}
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
        <div className="flex shrink-0 items-center border-b bg-muted/30 px-3">
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
      </Tabs>
    );
  }

  return (
    <Tabs
      value={tableTab}
      onValueChange={(v) => setTableTab(v as TableTab)}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center border-b bg-muted/30 px-3">
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="data">
            <TableIcon className="size-3.5" />
            Daten
          </TabsTrigger>
          <TabsTrigger value="columns">
            <Columns2Icon className="size-3.5" />
            Columns
          </TabsTrigger>
          <TabsTrigger value="triggers">
            <ZapIcon className="size-3.5" />
            Trigger
          </TabsTrigger>
        </TabsList>
        {tableTab === "data" && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => setAddRowOpen(true)}
            disabled={insertRowMutation.isPending}
          >
            <PlusIcon className="size-3.5" />
            Neue Zeile
          </Button>
        )}
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

      <NewRowDialog
        open={addRowOpen}
        onOpenChange={setAddRowOpen}
        schema={schema}
        table={table}
        columns={data?.columns ?? []}
        isPending={insertRowMutation.isPending}
        onSubmit={handleInsertRow}
      />
    </Tabs>
  );
}
