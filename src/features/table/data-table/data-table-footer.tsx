import type { SortingState } from "@tanstack/react-table";
import { ChevronFirstIcon, ChevronLastIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DataTableAutoRefresh } from "@/features/table/data-table-auto-refresh";
import type { autoRefreshPauseReason } from "@/lib/auto-refresh";
import { describeSelectionStats, type summarizeCells } from "@/lib/grid-selection";

type Props = {
  rowCount: number;
  page: number;
  pageSize: number;
  totalCount: number | undefined;
  selectionStats: ReturnType<typeof summarizeCells> | null;
  isFetching: boolean;
  activeSort: SortingState[number] | undefined;
  canEdit: boolean;
  onRefresh: (() => void | Promise<void>) | undefined;
  autoRefreshMs: number;
  autoRefreshPause: ReturnType<typeof autoRefreshPauseReason>;
  onAutoRefreshChange: (ms: number) => void;
  onPageChange: ((page: number) => void) | undefined;
};

export function DataTableFooter({
  rowCount,
  page,
  pageSize,
  totalCount,
  selectionStats,
  isFetching,
  activeSort,
  canEdit,
  onRefresh,
  autoRefreshMs,
  autoRefreshPause,
  onAutoRefreshChange,
  onPageChange,
}: Props) {
  const totalPages = totalCount != null ? Math.ceil(totalCount / pageSize) : undefined;
  const rangeStart = page * pageSize + 1;
  const rangeEnd = page * pageSize + rowCount;
  return (
    <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground select-none">
      <span className="whitespace-nowrap">
        {totalCount != null
          ? `${rangeStart}–${rangeEnd} von ${totalCount}`
          : `${rowCount} ${rowCount === 1 ? "Zeile" : "Zeilen"}`}
      </span>
      <div className="min-w-0 truncate text-center">
        {selectionStats ? (
          <span className="truncate font-mono">{describeSelectionStats(selectionStats)}</span>
        ) : isFetching ? (
          <span>Lade…</span>
        ) : activeSort ? (
          <span className="truncate">
            Sortiert nach{" "}
            <span className="font-mono font-semibold text-foreground bg-muted border border-border rounded px-1 py-[1px]">
              {activeSort.id}
            </span>{" "}
            ({activeSort.desc ? "absteigend" : "aufsteigend"})
          </span>
        ) : (
          <span>
            {canEdit
              ? "Pfeiltasten navigieren · Enter oder Klick auf die fokussierte Zelle zum Bearbeiten"
              : "Navigiere mit Pfeiltasten · Doppelklick zum Kopieren"}
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-4">
        {onRefresh && (
          <DataTableAutoRefresh
            intervalMs={autoRefreshMs}
            pauseReason={autoRefreshPause}
            onIntervalChange={onAutoRefreshChange}
          />
        )}
        {onPageChange && totalPages != null && totalPages > 1 && (
          <div className="flex items-center gap-1 border-l border-border/70 pl-3">
            <span className="mr-1 whitespace-nowrap">
              Seite {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPageChange(0)}
              className="inline-flex items-center justify-center size-6 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronFirstIcon className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              className="inline-flex items-center justify-center size-6 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronLeftIcon className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => onPageChange(page + 1)}
              className="inline-flex items-center justify-center size-6 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronRightIcon className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => onPageChange(totalPages - 1)}
              className="inline-flex items-center justify-center size-6 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronLastIcon className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
