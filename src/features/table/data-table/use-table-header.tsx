import {
  type ColumnPinningState,
  type ColumnSizingState,
  flexRender,
  type HeaderGroup,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import { useMemo } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DataTableColumnSettings } from "@/features/table/data-table-column-settings";
import { DataTableHeaderCell } from "@/features/table/data-table-header-cell";
import type { useColumnWindow } from "@/lib/hooks/use-column-window";
import {
  toggleHiddenColumn,
  togglePinnedColumn,
  type useTableColumnLayout,
} from "@/lib/table-column-prefs";
import type { DataTableProps, TableRow } from "../data-table-types";
import type { getColumnTypeInfo } from "./column-type-info";
import { INDEX_COLUMN } from "./constants";
import type { useColumnActions } from "./use-column-actions";
import type { useColumnFilter } from "./use-column-filter";

type Options = {
  headerGroups: HeaderGroup<TableRow>[];
  columnWindow: ReturnType<typeof useColumnWindow>;
  columnSizing: ColumnSizingState;
  resizingColumn: string | false;
  columnPinning: ColumnPinningState;
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>;
  layout: ReturnType<typeof useTableColumnLayout>;
  columnActions: ReturnType<typeof useColumnActions>;
  filter: ReturnType<typeof useColumnFilter>;
  visibleDataColumns: string[];
  isFetching: boolean;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  onApplyFilter: DataTableProps["onApplyFilter"];
  filterableColumns: string[] | undefined;
  filterOperators: DataTableProps["filterOperators"];
  filterPrefix: string | undefined;
  pinnedSet: Set<string>;
};

export function useTableHeader({
  headerGroups,
  columnWindow,
  columnSizing,
  resizingColumn,
  columnPinning,
  typeInfoByColumn,
  layout,
  columnActions,
  filter,
  visibleDataColumns,
  isFetching,
  sorting,
  onSortingChange,
  onApplyFilter,
  filterableColumns,
  filterOperators,
  filterPrefix,
  pinnedSet,
}: Options) {
  const {
    order,
    hidden,
    pinned,
    setOrder,
    setHidden,
    setPinned,
    reset,
    isCustomized,
    profiles,
    canUseProfiles,
    hasLegacy,
    importLegacy,
    saveProfile,
    applyProfile,
    renameProfile,
    deleteProfile,
  } = layout;
  const { togglingColumn, handleColumnToggle, fitHeaderWidths, copyColumnNames, copyColumnValues } =
    columnActions;
  const {
    filterColumn,
    setFilterColumn,
    filterOperator,
    setFilterOperator,
    filterValue,
    setFilterValue,
    compiledFilter,
    applyColumnFilter,
  } = filter;
  return useMemo(
    () => (
      <thead className="select-none">
        {headerGroups.map((headerGroup) => (
          <tr key={headerGroup.id}>
            {columnWindow.items.map((item) => {
              if (item.spacer)
                return (
                  <th
                    key={`gap-${item.index}`}
                    aria-hidden
                    colSpan={item.span}
                    className="sticky top-0 z-20 border-b border-border bg-muted"
                    style={{ width: item.width, padding: 0 }}
                  />
                );
              const header = headerGroup.headers[item.index];
              if (header.id === INDEX_COLUMN) {
                return (
                  <ContextMenu key={header.id}>
                    <ContextMenuTrigger asChild>
                      <th
                        title="Rechtsklick: Spalten"
                        className="w-12 sticky top-0 left-0 z-40 border-b border-r border-border bg-muted px-3 py-2 text-center align-middle"
                        style={{ width: header.getSize() }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-64">
                      <DataTableColumnSettings
                        columns={order}
                        hidden={hidden}
                        pinned={pinned}
                        isCustomized={isCustomized}
                        togglingColumn={togglingColumn}
                        onToggle={handleColumnToggle}
                        onReorder={setOrder}
                        onReset={reset}
                        onShowAll={() => setHidden([])}
                        onUnpinAll={() => setPinned([])}
                        onFitHeaderWidths={fitHeaderWidths}
                        onCopyColumnNames={copyColumnNames}
                        profiles={profiles}
                        canUseProfiles={canUseProfiles}
                        onImportLegacy={hasLegacy ? importLegacy : undefined}
                        onSaveProfile={saveProfile}
                        onApplyProfile={applyProfile}
                        onRenameProfile={renameProfile}
                        onDeleteProfile={deleteProfile}
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                );
              }
              return (
                <DataTableHeaderCell
                  key={header.id}
                  header={header}
                  sortableIndex={visibleDataColumns.indexOf(header.id)}
                  isFetching={isFetching}
                  sorting={sorting}
                  onSortingChange={onSortingChange}
                  filterOpen={filterColumn === header.id}
                  onFilterOpenChange={(open) => {
                    if (open) setFilterColumn(header.id);
                    else setFilterColumn(null);
                  }}
                  filterOperator={filterOperator}
                  onFilterOperatorChange={setFilterOperator}
                  filterValue={filterValue}
                  onFilterValueChange={setFilterValue}
                  compiledFilter={filterColumn === header.id ? compiledFilter : ""}
                  filterOperators={filterOperators}
                  filterPrefix={filterPrefix}
                  onApplyFilter={
                    !filterableColumns || filterableColumns.includes(header.id)
                      ? onApplyFilter
                      : undefined
                  }
                  onApplyColumnFilter={applyColumnFilter}
                  onHideColumn={() => setHidden(toggleHiddenColumn(order, hidden, header.id))}
                  canHide={visibleDataColumns.length > 1}
                  isPinned={pinnedSet.has(header.id)}
                  onTogglePin={() => setPinned(togglePinnedColumn(order, pinned, header.id))}
                  onCopyColumn={() => copyColumnValues(header.id)}
                />
              );
            })}
          </tr>
        ))}
      </thead>
    ),
    [
      headerGroups,
      columnWindow.items,
      columnSizing,
      resizingColumn,
      columnPinning,
      typeInfoByColumn,
      order,
      hidden,
      pinned,
      isCustomized,
      setHidden,
      setOrder,
      reset,
      setPinned,
      copyColumnNames,
      copyColumnValues,
      fitHeaderWidths,
      profiles,
      canUseProfiles,
      hasLegacy,
      importLegacy,
      saveProfile,
      applyProfile,
      renameProfile,
      deleteProfile,
      visibleDataColumns,
      isFetching,
      sorting,
      onSortingChange,
      filterColumn,
      filterOperator,
      filterValue,
      compiledFilter,
      onApplyFilter,
      filterableColumns,
      filterOperators,
      filterPrefix,
      applyColumnFilter,
      pinnedSet,
    ],
  );
}
