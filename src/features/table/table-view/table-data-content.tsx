import { FilterXIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { AiFlash } from "@/features/automation/ai-flash";
import { DataTable } from "@/features/table/data-table";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { TableFilterBar } from "@/features/table/table-filter-bar";
import { TableViewsPanel } from "@/features/table/table-views-panel";
import { canEditRedisCell, REDIS_KEY_FILTER_OPERATORS, redisKeyFilter } from "@/lib/redis-commands";
import { discardStagedChange, stagedMarkOf } from "@/lib/staged-edits";
import { tableColumnPrefKey, useTableColumnPrefs } from "@/lib/table-column-prefs";
import { useTableViewStateStore } from "@/lib/table-view-state";
import { savedViewPatch } from "@/lib/views";
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
  | "stagedKey"
  | "collecting"
  | "rowOffset"
  | "rowExtent"
  | "onVisibleRowsChange"
  | "masked"
  | "saveRow"
  | "addRow"
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
  | "sortableColumns"
  | "setSorting"
  | "revealColumn"
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
  stagedKey,
  collecting,
  rowOffset,
  rowExtent,
  onVisibleRowsChange,
  masked,
  saveRow,
  addRow,
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
  sortableColumns,
  revealColumn,
  setPage,
  addRowSignal,
  schema,
  table,
  emptyMessage,
}: Props) {
  const gridReady = useDeferredValue(!isLoading, false);
  const redis = caps.query_language === "redis";
  const handleSortingChange = useCallback<typeof setSorting>(
    (update) => {
      setSorting(update);
      setPage(0);
    },
    [setSorting, setPage],
  );

  const watchScope =
    stateKey && !masked && (columnDetails ?? []).some((column) => column.is_primary_key)
      ? stateKey
      : undefined;
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {stateKey && <AiFlash id={`table:${stateKey}`} neon />}
      <div
        className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden"
        data-tour="table-filter"
      >
        <TableFilterBar
          leading={
            <TableViewsPanel
              schema={schema}
              table={table}
              stateKey={stateKey}
              activeFilter={filter}
              filterRaw={filterRaw}
              onSelectView={(nextFilter, raw, saved) => {
                handleFilterChange(nextFilter, raw);
                const patch = savedViewPatch(saved, nextFilter, raw);
                if (stateKey && patch) useTableViewStateStore.getState().patch(stateKey, patch);
                if (connection && saved?.layout)
                  useTableColumnPrefs
                    .getState()
                    .setPref(
                      tableColumnPrefKey(connection.id, schema, table, database),
                      saved.layout,
                    );
              }}
            />
          }
          key={stateKey}
          stateKey={stateKey}
          columns={data?.columns ?? []}
          columnDetails={columnDetails}
          activeFilter={filter}
          onApply={handleFilterChange}
          sort={{
            sorting,
            sortableColumns: redis ? REDIS_KEY_COLUMNS : sortableColumns,
            onChange: handleSortingChange,
          }}
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
          watchScope={watchScope}
          scrollIdentity={JSON.stringify([filter, filterRaw, sorting, rowLimit])}
          className="h-full min-h-0 flex-1"
          columns={data?.columns ?? NO_COLUMNS}
          data={tableRows}
          emptyMessage={emptyMessage}
          sorting={sorting}
          sortableColumns={redis ? REDIS_KEY_COLUMNS : sortableColumns}
          onSortingChange={handleSortingChange}
          isFetching={isFetching}
          onSaveRow={
            masked || connection?.readOnly
              ? undefined
              : caps.query_language === "redis"
                ? saveRedisRow
                : isView || !caps.row_edit
                  ? undefined
                  : saveRow
          }
          canEditCell={
            caps.query_language === "redis"
              ? canEditRedisCell
              : collecting
                ? canEditStagedCell
                : undefined
          }
          rowMenuItems={
            stagedKey
              ? (row) => {
                  const mark = stagedMarkOf(row);
                  return mark ? (
                    <ContextMenuItem onSelect={() => discardStagedChange(stagedKey, mark.changeId)}>
                      Änderung verwerfen
                    </ContextMenuItem>
                  ) : null;
                }
              : undefined
          }
          cellEditorKind={caps.query_language === "redis" ? "text" : undefined}
          emptyEditValue={caps.query_language === "redis" ? "" : undefined}
          filterableColumns={redis ? REDIS_KEY_COLUMNS : undefined}
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
          rowOffset={rowOffset}
          rowExtent={rowExtent}
          onVisibleRowsChange={onVisibleRowsChange}
          totalCount={totalCount ?? undefined}
          countLabel={countLabel}
          onExactCount={handleExactCount}
          pageSize={rowLimit}
          foreignKeys={foreignKeys}
          currentSchema={schema}
          currentTable={table}
          recordView
          onNavigateToTable={handleNavigateToTable}
          onInsertRow={
            masked || isView || !caps.row_edit || connection?.readOnly ? undefined : addRow
          }
          onDeleteRow={
            masked || isView || !caps.row_edit || connection?.readOnly ? undefined : handleDeleteRow
          }
          columnDetails={columnDetails}
          onRefresh={handleRefresh}
          searchRequiresFocus={inDrawer}
          addRowSignal={addRowSignal}
        />
      )}
    </div>
  );
}

const NO_COLUMNS: string[] = [];
const canEditStagedCell = (row: Record<string, unknown>) => stagedMarkOf(row)?.type !== "delete";
const REDIS_KEY_COLUMNS = ["key"];
