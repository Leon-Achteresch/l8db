import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  FilterIcon,
  FilterXIcon,
} from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { QueryResult } from "@/lib/db";
import { useColumnWindow } from "@/lib/hooks/use-column-window";
import { useQueryWorkspace } from "@/lib/query-workspace";
import {
  activeFilterCount,
  applyResultView,
  describeResultCount,
  isFilterActive,
  type ResultFilterOperator,
  type ResultFilters,
  type ResultSort,
  resultFilterOperatorLabel,
  sortDirectionFor,
  sortRankFor,
  toggleResultSort,
} from "@/lib/result-grid";
import { cn } from "@/lib/utils";

const PINNED_COLUMNS = [0];

const FILTER_OPERATORS: ResultFilterOperator[] = ["contains", "equals", "is_null", "not_null"];

interface QueryResultTableProps {
  result: QueryResult | null;
  isLoading: boolean;
  error: string | null;
  onInspect?: (column: string, value: unknown, row: number) => void;
}

export const QueryResultTable = memo(function QueryResultTable({
  result,
  isLoading,
  error,
  onInspect,
}: QueryResultTableProps) {
  const workspace = useQueryWorkspace();
  const [sorts, setSorts] = useState<ResultSort[]>([]);
  const [filters, setFilters] = useState<ResultFilters>({});
  const [filterRowOpen, setFilterRowOpen] = useState(false);

  const [lastResult, setLastResult] = useState(result);
  if (result !== lastResult) {
    setLastResult(result);
    setSorts([]);
    setFilters({});
    setFilterRowOpen(false);
  }

  const columns = useMemo(() => result?.columns ?? [], [result]);
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const deferredFilters = useDeferredValue(filters);
  const visibleRows = useMemo(
    () => applyResultView(rows, columns, sorts, deferredFilters),
    [rows, columns, sorts, deferredFilters],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnWidths = useMemo(
    () => [48, ...columns.map(() => workspace.resultColumnWidth)],
    [columns, workspace.resultColumnWidth],
  );
  const columnWindow = useColumnWindow(scrollRef, columnWidths, PINNED_COLUMNS);
  const dataColumnWindow = useMemo(
    () => columnWindow.items.filter((item) => item.index !== 0),
    [columnWindow.items],
  );
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => Math.max(workspace.resultRowHeight, workspace.resultFontSize + 12),
    overscan: 10,
  });
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, workspace.resultFontSize, workspace.resultRowHeight, workspace.resultView]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom = rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0);

  const filterCount = activeFilterCount(filters);
  const viewActive = filterCount > 0 || sorts.length > 0;

  const setFilter = (column: string, patch: Partial<ResultFilters[string]>) => {
    setFilters((prev) => {
      const current = prev[column] ?? {
        operator: "contains" as ResultFilterOperator,
        value: "",
      };
      return { ...prev, [column]: { ...current, ...patch } };
    });
  };

  const resetView = () => {
    setSorts([]);
    setFilters({});
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-card/40">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <svg
            className="size-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            role="img"
            aria-label="Wird ausgeführt"
          >
            <title>Wird ausgeführt</title>
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Ausführen…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-start gap-2 overflow-auto p-5">
        <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
          Fehler
        </span>
        <pre className="whitespace-pre-wrap font-mono text-sm text-destructive">{error}</pre>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center bg-card/30">
        <p className="text-sm text-muted-foreground">
          Drücke{" "}
          <kbd className="rounded-full border bg-muted px-2 py-0.5 font-mono text-xs">⌘ Enter</kbd>{" "}
          um die Abfrage auszuführen.
        </p>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-card/30">
        <p className="text-sm text-muted-foreground">
          {result.rows_affected !== null && result.rows_affected !== undefined
            ? `${result.rows_affected} Zeile${result.rows_affected === 1 ? "" : "n"} betroffen`
            : "Kein Ergebnis"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <span className="text-xs font-medium tabular-nums text-foreground">
          {describeResultCount(visibleRows.length, rows.length)}
        </span>
        <span className="text-xs text-muted-foreground">
          Sortierung und Filter gelten nur für die geladenen Zeilen (lokal, keine neue Abfrage).
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant={filterRowOpen ? "secondary" : "ghost"}
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setFilterRowOpen((open) => !open)}
          >
            <FilterIcon className="size-3" />
            Filter
            {filterCount > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary">
                {filterCount}
              </span>
            )}
          </Button>
          {viewActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={resetView}
            >
              <FilterXIcon className="size-3" />
              Zurücksetzen
            </Button>
          )}
        </div>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <table
          className="w-full border-separate border-spacing-0 text-sm"
          style={
            columnWindow.enabled
              ? { tableLayout: "fixed", width: 48 + columns.length * 200 }
              : undefined
          }
        >
          {columnWindow.enabled && (
            <colgroup>
              {columnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
          )}
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 min-w-12 border-b border-r bg-muted px-3 py-1.5 text-right text-xs font-medium text-muted-foreground">
                #
              </th>
              {dataColumnWindow.map((item) => {
                if (item.spacer)
                  return (
                    <th
                      key={`gap-${item.index}`}
                      aria-hidden
                      colSpan={item.span}
                      style={{ width: item.width, padding: 0 }}
                    />
                  );
                const col = columns[item.index - 1];
                const direction = sortDirectionFor(sorts, col);
                const rank = sortRankFor(sorts, col);
                return (
                  <th
                    key={col}
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                    }
                    className="border-b border-r bg-muted/90 p-0 text-left"
                  >
                    <button
                      type="button"
                      title={`Lokal sortieren nach ${col} (Umschalt-Klick für mehrere Spalten)`}
                      onClick={(event) =>
                        setSorts((prev) =>
                          toggleResultSort(prev, col, event.shiftKey || event.altKey),
                        )
                      }
                      className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs font-semibold text-foreground hover:bg-muted"
                    >
                      <span className="truncate">{col}</span>
                      {direction === "asc" && <ArrowUpIcon className="size-3 shrink-0" />}
                      {direction === "desc" && <ArrowDownIcon className="size-3 shrink-0" />}
                      {!direction && <ChevronsUpDownIcon className="size-3 shrink-0 opacity-25" />}
                      {rank !== null && sorts.length > 1 && (
                        <span className="font-mono text-[10px] text-muted-foreground">{rank}</span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
            {filterRowOpen && (
              <tr>
                <th className="sticky left-0 z-20 border-b border-r bg-muted px-1 py-1" />
                {dataColumnWindow.map((item) => {
                  if (item.spacer)
                    return (
                      <th
                        key={`gap-${item.index}`}
                        aria-hidden
                        colSpan={item.span}
                        style={{ width: item.width, padding: 0 }}
                      />
                    );
                  const col = columns[item.index - 1];
                  const filter = filters[col] ?? {
                    operator: "contains" as ResultFilterOperator,
                    value: "",
                  };
                  const needsValue = filter.operator === "contains" || filter.operator === "equals";
                  return (
                    <th key={col} className="border-b border-r bg-muted/70 px-1 py-1">
                      <div className="flex items-center gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn(
                                "h-6 shrink-0 px-1.5 text-[10px] font-normal",
                                isFilterActive(filter) && "text-primary",
                              )}
                            >
                              {resultFilterOperatorLabel(filter.operator)}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {FILTER_OPERATORS.map((operator) => (
                              <DropdownMenuCheckboxItem
                                key={operator}
                                checked={filter.operator === operator}
                                onCheckedChange={() => setFilter(col, { operator })}
                              >
                                {resultFilterOperatorLabel(operator)}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {needsValue && (
                          <Input
                            value={filter.value}
                            onChange={(event) => setFilter(col, { value: event.target.value })}
                            placeholder="Filter"
                            aria-label={`Filter für ${col}`}
                            className="h-6 min-w-0 flex-1 px-1.5 font-mono text-xs"
                          />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: paddingTop }}>
                <td colSpan={columns.length + 1} className="p-0" />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const rowIdx = virtualRow.index;
              const row = visibleRows[rowIdx];
              return (
                <tr
                  key={rowIdx}
                  ref={rowVirtualizer.measureElement}
                  data-index={rowIdx}
                  style={{
                    height: Math.max(workspace.resultRowHeight, workspace.resultFontSize + 12),
                  }}
                  className={cn(
                    "group hover:bg-muted/50",
                    workspace.stripedRows && rowIdx % 2 !== 0 ? "bg-muted/20" : "bg-background",
                  )}
                >
                  <td className="sticky left-0 border-b border-r bg-inherit px-3 py-1 text-right font-mono text-xs text-muted-foreground">
                    {rowIdx + 1}
                  </td>
                  {dataColumnWindow.map((item) => {
                    if (item.spacer)
                      return (
                        <td
                          key={`gap-${item.index}`}
                          aria-hidden
                          colSpan={item.span}
                          style={{ width: item.width, padding: 0 }}
                        />
                      );
                    const col = columns[item.index - 1];
                    const raw = row[col];
                    const isNull = raw === null || raw === undefined;
                    const display = isNull
                      ? "NULL"
                      : String(raw).length > 200
                        ? `${String(raw).slice(0, 200)}…`
                        : String(raw);
                    return (
                      <td
                        key={col}
                        data-col={col}
                        style={{ fontSize: workspace.resultFontSize }}
                        title={isNull ? undefined : String(raw)}
                        className={cn(
                          "max-w-xs overflow-hidden text-ellipsis whitespace-nowrap border-b border-r px-3 py-1 font-mono",
                          isNull && "text-muted-foreground/50 italic",
                        )}
                      >
                        {onInspect ? (
                          <button
                            type="button"
                            className="block w-full truncate text-left focus-visible:outline-2 focus-visible:outline-ring"
                            title="Vollständigen Zellwert anzeigen"
                            onClick={() => onInspect(col, raw, rowIdx + 1)}
                          >
                            {display}
                          </button>
                        ) : (
                          display
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: paddingBottom }}>
                <td colSpan={columns.length + 1} className="p-0" />
              </tr>
            )}
          </tbody>
        </table>
        {visibleRows.length === 0 && rows.length > 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            Keine der {rows.length} geladenen Zeilen entspricht den Filtern.
          </p>
        )}
      </div>
    </div>
  );
});
