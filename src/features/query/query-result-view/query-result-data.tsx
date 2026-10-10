import { FilterXIcon, RefreshCwIcon, TableIcon } from "lucide-react";
import { useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/features/table/data-table";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { TableFilterPanel } from "@/features/table/table-filter-panel";
import { QUERY_RESULT_SCHEMA } from "@/lib/query-result-view";
import type { QueryResultViewModel } from "./use-query-result-view-model";

interface QueryResultDataProps {
  model: QueryResultViewModel;
  text: string;
  columns: string[];
  onShowClassic: () => void;
}

export function QueryResultData({ model, text, columns, onShowClassic }: QueryResultDataProps) {
  const gridReady = useDeferredValue(!model.isLoading, false);
  const { stateKey, filter, filterRaw, sorting, setSorting, page, setPage, handleFilterChange } =
    model;
  const emptyMessage = filter.trim() === "" ? "Keine Daten." : "Keine Zeilen für diesen Filter.";

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden">
        <TableFilterPanel
          key={stateKey}
          stateKey={stateKey}
          columns={model.data?.columns ?? columns}
          columnDetails={model.columnDetails}
          activeFilter={filter}
          onApply={handleFilterChange}
        />
      </div>
      {model.isLoading || (!model.isError && !gridReady) ? (
        <TableDataSkeleton />
      ) : model.isError ? (
        <TableDataError
          title="Fehler beim Laden des Ergebnisses"
          error={model.error}
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
              <Button size="sm" variant="ghost" onClick={() => void model.refetch()}>
                <RefreshCwIcon />
                Erneut versuchen
              </Button>
              <Button size="sm" variant="ghost" onClick={onShowClassic}>
                <TableIcon />
                Klassische Ansicht
              </Button>
            </>
          }
        />
      ) : (
        <DataTable
          key={stateKey}
          stateKey={stateKey}
          scrollIdentity={JSON.stringify([filter, filterRaw, sorting, page, model.rowLimit])}
          className="h-full min-h-0 flex-1"
          columns={model.data?.columns ?? columns}
          data={model.rows}
          emptyMessage={emptyMessage}
          sorting={sorting}
          onSortingChange={(update) => {
            setSorting(update);
            setPage(0);
          }}
          isFetching={model.isFetching}
          onApplyFilter={handleFilterChange}
          page={page}
          totalCount={model.totalCount}
          countLabel={model.countLabel}
          onExactCount={model.handleExactCount}
          pageSize={model.rowLimit}
          onPageChange={setPage}
          foreignKeys={model.foreignKeys}
          currentSchema={QUERY_RESULT_SCHEMA}
          currentTable={text}
          onNavigateToTable={model.handleNavigateToTable}
          columnDetails={model.columnDetails}
          onRefresh={model.handleRefresh}
        />
      )}
    </div>
  );
}
