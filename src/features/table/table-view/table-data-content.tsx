import { FilterXIcon, RefreshCwIcon } from "lucide-react";
import { useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/features/table/data-table";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { TableFilterPanel } from "@/features/table/table-filter-panel";
import { TableViewsPanel } from "@/features/table/table-views-panel";
import { canEditRedisCell, REDIS_KEY_FILTER_OPERATORS, redisKeyFilter } from "@/lib/redis-commands";
import { tableColumnPrefKey, useTableColumnPrefs } from "@/lib/table-column-prefs";
import { useTableViewStateStore } from "@/lib/table-view-state";

import type { useTableViewModel } from "./use-table-view-model";

type Props = Pick<
  ReturnType<typeof useTableViewModel>,
  | "inDrawer"
  | "isView"
  | "connection"
  | "database"
  | "saveRedisRow"
  | "rowLimit"
  | "stateKey"
  | "caps"
  | "tableRows"
  | "updateRowMutation"
  | "insertRowMutation"
  | "handleFilterChange"
  | "handleDeleteRow"
  | "handleRefresh"
  | "handleNavigateToTable"
  | "foreignKeys"
  | "data"
  | "isLoading"
  | "isFetching"
  | "isError"
  | "error"
  | "refetch"
  | "totalCount"
  | "countLabel"
  | "handleExactCount"
  | "columnDetails"
  | "filter"
  | "filterRaw"
  | "sorting"
  | "setSorting"
  | "revealColumn"
  | "setRevealColumn"
  | "page"
  | "setPage"
  | "addRowSignal"
> & {
  schema: string;
  table: string;
  emptyMessage: string;
};

export function TableDataContent({
  inDrawer,
  isView,
  connection,
  database,
  saveRedisRow,
  rowLimit,
  stateKey,
  caps,
  tableRows,
  updateRowMutation,
  insertRowMutation,
  handleFilterChange,
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
  filter,
  filterRaw,
  sorting,
  setSorting,
  revealColumn,
  setRevealColumn,
  page,
  setPage,
  addRowSignal,
  schema,
  table,
  emptyMessage,
}: Props) {
  const gridReady = useDeferredValue(!isLoading, false);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TableViewsPanel
        schema={schema}
        table={table}
        activeFilter={filter}
        filterRaw={filterRaw}
        onSelectView={(nextFilter, raw, saved) => {
          handleFilterChange(nextFilter, raw);
          if (stateKey && saved?.state)
            useTableViewStateStore.getState().patch(stateKey, {
              ...saved.state,
              filter: nextFilter,
              filterRaw: raw ?? false,
              page: 0,
            });
          if (connection && saved?.layout)
            useTableColumnPrefs
              .getState()
              .setPref(tableColumnPrefKey(connection.id, schema, table, database), saved.layout);
        }}
      />
      <div
        className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden"
        data-tour="table-filter"
      >
        <TableFilterPanel
          key={stateKey}
          stateKey={stateKey}
          columns={data?.columns ?? []}
          columnDetails={columnDetails}
          activeFilter={filter}
          onApply={handleFilterChange}
          onColumnSelect={(name) => setRevealColumn({ name, nonce: Date.now() })}
        />
      </div>
      {isLoading || (!isError && !gridReady) ? (
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
          key={stateKey}
          stateKey={stateKey}
          scrollIdentity={JSON.stringify([filter, filterRaw, sorting, page, rowLimit])}
          className="h-full min-h-0 flex-1"
          columns={data?.columns ?? []}
          data={tableRows}
          emptyMessage={emptyMessage}
          sorting={sorting}
          sortableColumns={caps.query_language === "redis" ? ["key"] : undefined}
          onSortingChange={(update) => {
            setSorting(update);
            setPage(0);
          }}
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
          countLabel={countLabel}
          onExactCount={handleExactCount}
          pageSize={rowLimit}
          onPageChange={setPage}
          foreignKeys={foreignKeys}
          currentSchema={schema}
          currentTable={table}
          onNavigateToTable={handleNavigateToTable}
          onInsertRow={
            isView || !caps.row_edit || connection?.readOnly
              ? undefined
              : async (values) => {
                  await insertRowMutation.mutateAsync(values);
                }
          }
          onDeleteRow={isView || !caps.row_edit ? undefined : handleDeleteRow}
          columnDetails={columnDetails}
          onRefresh={handleRefresh}
          searchRequiresFocus={inDrawer}
          addRowSignal={addRowSignal}
        />
      )}
    </div>
  );
}
