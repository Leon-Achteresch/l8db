import { Suspense } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ObjectAuditPanel } from "@/features/object-admin/object-audit-panel";
import { TableColumnsList } from "@/features/table/table-columns-list";
import { TableCommentBar } from "@/features/table/table-comment-bar";
import { TableConstraintsList } from "@/features/table/table-constraints-list";
import { TableDetailTabBar } from "@/features/table/table-detail-tab-bar";
import { TableGrantsPanel } from "@/features/table/table-grants-panel";
import { TableIndexesList } from "@/features/table/table-indexes-list";
import { TablePartitionsPanel } from "@/features/table/table-partitions-panel";
import { TableRlsPanel } from "@/features/table/table-rls-panel";
import { TableTriggersList } from "@/features/table/table-triggers-list";
import { TableUsedByPanel } from "@/features/table/table-used-by-panel";
import type { TableDetailTab } from "@/lib/table-detail-tabs";
import { TablePerfPanel } from "./table-view/lazy-panels";
import { TableDataContent } from "./table-view/table-data-content";
import { TableExportDialogs } from "./table-view/table-export-dialogs";
import { TableToolbarActions } from "./table-view/table-toolbar-actions";
import { useTableViewModel } from "./table-view/use-table-view-model";
import { ViewDetailTabs } from "./table-view/view-detail-tabs";

export interface TableViewProps {
  schema: string;
  table: string;
  type?: "table" | "view";
  fkFilter?: string;
  fkRaw?: boolean;
  column?: string;
  drawerId?: string;
}

export function TableView(props: TableViewProps) {
  const { schema, table } = props;
  const {
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
    totalCount,
    countLabel,
    handleExactCount,
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
    addRowSignal,
  } = useTableViewModel(props);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  const emptyMessage = filter.trim() === "" ? "Keine Daten." : "Keine Zeilen für diesen Filter.";

  const dataContent = (
    <TableDataContent
      inDrawer={inDrawer}
      isView={isView}
      connection={connection}
      database={database}
      saveRedisRow={saveRedisRow}
      rowLimit={rowLimit}
      stateKey={stateKey}
      caps={caps}
      tableRows={tableRows}
      updateRowMutation={updateRowMutation}
      insertRowMutation={insertRowMutation}
      handleFilterChange={handleFilterChange}
      handleDeleteRow={handleDeleteRow}
      handleRefresh={handleRefresh}
      handleNavigateToTable={handleNavigateToTable}
      foreignKeys={foreignKeys}
      data={data}
      isLoading={isLoading}
      isFetching={isFetching}
      isError={isError}
      error={error}
      refetch={refetch}
      totalCount={totalCount}
      countLabel={countLabel}
      handleExactCount={handleExactCount}
      columnDetails={columnDetails}
      filter={filter}
      filterRaw={filterRaw}
      sorting={sorting}
      setSorting={setSorting}
      revealColumn={revealColumn}
      setRevealColumn={setRevealColumn}
      page={page}
      setPage={setPage}
      addRowSignal={addRowSignal}
      schema={schema}
      table={table}
      emptyMessage={emptyMessage}
    />
  );

  if (isView) {
    return (
      <ViewDetailTabs
        caps={caps}
        availableTabs={availableTabs}
        viewTab={viewTab}
        data={data}
        exporting={exporting}
        csvExportOpen={csvExportOpen}
        setCsvExportOpen={setCsvExportOpen}
        xlsxExportOpen={xlsxExportOpen}
        setXlsxExportOpen={setXlsxExportOpen}
        exportColumns={exportColumns}
        exportRows={exportRows}
        fullExportSource={fullExportSource}
        handleExport={handleExport}
        setDetailTab={setDetailTab}
        filter={filter}
        schema={schema}
        table={table}
        dataContent={dataContent}
      />
    );
  }

  return (
    <Tabs
      value={tableTab}
      onValueChange={(v) => setDetailTab(v as TableDetailTab)}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        className="flex shrink-0 items-center border-b bg-muted/30 px-3"
        data-tour="table-toolbar"
      >
        <TableDetailTabBar tabs={availableTabs} />
        <TableToolbarActions
          connection={connection}
          database={database}
          stateKey={stateKey}
          caps={caps}
          tableTab={tableTab}
          insertRowMutation={insertRowMutation}
          data={data}
          refetch={refetch}
          exporting={exporting}
          setCsvExportOpen={setCsvExportOpen}
          setXlsxExportOpen={setXlsxExportOpen}
          handleExport={handleExport}
          requestAddRow={requestAddRow}
          schema={schema}
          table={table}
        />
      </div>
      <TableCommentBar schema={schema} table={table} />

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
        <TableColumnsList schema={schema} table={table} editable />
      </TabsContent>

      <TabsContent value="triggers" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableTriggersList schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="indexes" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableIndexesList schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="constraints" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableConstraintsList schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="rls" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableRlsPanel schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="partitions" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TablePartitionsPanel schema={schema} table={table} />
      </TabsContent>

      <TabsContent value="grants" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableGrantsPanel schema={schema} name={table} />
      </TabsContent>

      <TabsContent value="used-by" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableUsedByPanel schema={schema} name={table} />
      </TabsContent>

      <TabsContent value="performance" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense
          fallback={
            <div role="status" className="p-4 text-sm text-muted-foreground">
              Ansicht wird geladen…
            </div>
          }
        >
          <TablePerfPanel schema={schema} table={table} filter={filter} isView={false} />
        </Suspense>
      </TabsContent>

      <TabsContent value="audit" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {caps.object_admin && <ObjectAuditPanel schema={schema} name={table} objectType="table" />}
      </TabsContent>

      <TableExportDialogs
        table={table}
        csvExportOpen={csvExportOpen}
        setCsvExportOpen={setCsvExportOpen}
        xlsxExportOpen={xlsxExportOpen}
        setXlsxExportOpen={setXlsxExportOpen}
        exportColumns={exportColumns}
        exportRows={exportRows}
        fullExportSource={fullExportSource}
      />
    </Tabs>
  );
}
