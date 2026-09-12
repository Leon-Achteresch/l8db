import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  FilterIcon,
  FilterXIcon,
  Maximize2Icon,
} from "lucide-react";
import { memo, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import type { DatabaseKind, QueryResult } from "@/lib/db";
import { dbErrorCode } from "@/lib/db-error-codes";
import { useColumnWindow } from "@/lib/hooks/use-column-window";
import { useRowMarkers } from "@/lib/hooks/use-row-markers";
import { MasterSelectionContext, useMasterDetail } from "@/lib/master-detail";
import { useQueryWorkspace } from "@/lib/query-workspace";
import {
  activeFilterCount,
  applyResultView,
  describeResultCount,
  isFilterActive,
  normalizeResultFilterOperator,
  type ResultFilterOperator,
  type ResultFilters,
  type ResultSort,
  resultFilterOperatorLabel,
  sortDirectionFor,
  sortRankFor,
  toggleResultSort,
} from "@/lib/result-grid";
import { useSettingsStore } from "@/lib/settings";
import { changeFilterOperator, OPERATORS, operatorNeedsValue } from "@/lib/sql-filter";
import { cn } from "@/lib/utils";

import { QueryResultRow } from "./query-result-row";

const PINNED_COLUMNS = [0];

const FILTER_OPERATORS = OPERATORS.map((operator) => operator.key);

interface QueryResultTableProps {
  result: QueryResult | null;
  isLoading: boolean;
  error: string | null;
  kind?: DatabaseKind;
  onInspect?: (column: string, value: unknown, row: number) => void;
}

export const QueryResultTable = memo(function QueryResultTable({
  result,
  isLoading,
  error,
  kind,
  onInspect,
}: QueryResultTableProps) {
  const workspace = useQueryWorkspace();
  const selectionKey = useContext(MasterSelectionContext);
  const masterCell = useMasterDetail((state) =>
    selectionKey ? state.selections[selectionKey] : undefined,
  );
  useEffect(() => {
    if (!selectionKey) return;
    const saved = useMasterDetail.getState().selections[selectionKey];
    if (
      saved &&
      (isLoading ||
        error ||
        !result?.rows[saved.rowIndex] ||
        !Object.is(result.rows[saved.rowIndex][saved.column], saved.value))
    ) {
      useMasterDetail.getState().selectCell(selectionKey, null);
    }
  }, [selectionKey, result, isLoading, error]);
  const translatedOperators = useSettingsStore((state) => state.translateFilterOperators);
  const uiScale = useSettingsStore((state) => state.uiScale);
  const uiDensity = useSettingsStore((state) => state.uiDensity);
  const rowHeight =
    (Math.max(
      Math.max(workspace.resultRowHeight, workspace.resultFontSize + 12) +
        (uiDensity === "compact" ? -8 : uiDensity === "spacious" ? 8 : 0),
      workspace.resultFontSize + 8,
    ) *
      uiScale) /
    100;
  const [sorts, setSorts] = useState<ResultSort[]>([]);
  const [filters, setFilters] = useState<ResultFilters>({});
  const [filterRowOpen, setFilterRowOpen] = useState(false);
  const [autoColumnWidths, setAutoColumnWidths] = useState<Record<string, number>>({});

  const [lastResult, setLastResult] = useState(result);
  if (result !== lastResult) {
    setLastResult(result);
    setSorts([]);
    setFilters({});
    setFilterRowOpen(false);
    setAutoColumnWidths({});
  }

  const columns = useMemo(() => result?.columns ?? [], [result]);
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const { markedRows, toggleRowMarker } = useRowMarkers(rows);
  const originalIndices = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  const deferredFilters = useDeferredValue(filters);
  const visibleRows = useMemo(
    () => applyResultView(rows, columns, sorts, deferredFilters),
    [rows, columns, sorts, deferredFilters],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnWidths = useMemo(
    () => [48, ...columns.map((column) => autoColumnWidths[column] ?? workspace.resultColumnWidth)],
    [columns, workspace.resultColumnWidth, autoColumnWidths],
  );
  const tableWidth = useMemo(
    () => columnWidths.reduce((sum, width) => sum + width, 0),
    [columnWidths],
  );
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: Math.ceil(256 / rowHeight),
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });
  useEffect(() => {
    if (rowHeight > 0) rowVirtualizer.measure();
  }, [rowVirtualizer, rowHeight]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom = rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0);

  const columnWindow = useColumnWindow(scrollRef, columnWidths, PINNED_COLUMNS);
  const dataColumnWindow = useMemo(
    () => columnWindow.items.filter((item) => item.index !== 0),
    [columnWindow.items],
  );

  const columnScale = Math.max(1, (rowVirtualizer.scrollRect?.width ?? 0) / tableWidth);
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

  const autoSizeColumns = () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = `${(workspace.resultFontSize * uiScale) / 100}px ${getComputedStyle(document.body).fontFamily}`;
    const nextWidths = Object.fromEntries(
      columns.map((column) => [column, Math.ceil(context.measureText(column).width) + 48]),
    );
    setAutoColumnWidths(nextWidths);
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
    const errorCode = dbErrorCode(kind, error);
    return (
      <div className="flex h-full flex-col items-start gap-2 overflow-auto p-5">
        <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
          Fehler
        </span>
        <pre className="whitespace-pre-wrap font-mono text-sm text-destructive">{error}</pre>
        {errorCode && (
          <p className="text-xs text-muted-foreground">
            Fehlercode <span className="font-mono font-semibold">{errorCode.code}</span> ·{" "}
            {errorCode.description}
          </p>
        )}
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
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={autoSizeColumns}
            title="Alle Spaltenbreiten an die Header-Texte anpassen"
          >
            <Maximize2Icon className="size-3" />
            Headerbreite
          </Button>
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
      <div
        ref={scrollRef}
        style={{ contain: "strict" }}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <table
          className="w-full border-separate border-spacing-0 text-sm"
          style={
            columnWindow.enabled || Object.keys(autoColumnWidths).length > 0
              ? {
                  tableLayout: "fixed",
                  width: tableWidth,
                }
              : undefined
          }
        >
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
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
                  const needsValue = operatorNeedsValue(
                    normalizeResultFilterOperator(filter.operator),
                  );
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
                              {resultFilterOperatorLabel(filter.operator, translatedOperators)}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {FILTER_OPERATORS.map((operator) => (
                              <DropdownMenuCheckboxItem
                                key={operator}
                                checked={
                                  normalizeResultFilterOperator(filter.operator) === operator
                                }
                                onCheckedChange={() =>
                                  setFilter(col, {
                                    operator,
                                    value: changeFilterOperator(
                                      filter.value,
                                      normalizeResultFilterOperator(filter.operator),
                                      operator,
                                    ),
                                  })
                                }
                              >
                                {resultFilterOperatorLabel(operator, translatedOperators)}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {needsValue && (
                          <FilterValueInput
                            key={filter.operator}
                            operator={normalizeResultFilterOperator(filter.operator)}
                            value={filter.value}
                            onValueChange={(value) => setFilter(col, { value })}
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
              const isMarked = markedRows.has(row);
              const originalIndex = originalIndices.get(row) ?? rowIdx;
              return (
                <QueryResultRow
                  key={rowIdx}
                  row={row}
                  rowIdx={rowIdx}
                  originalIndex={originalIndex}
                  isMarked={isMarked}
                  toggleRowMarker={toggleRowMarker}
                  selectionKey={selectionKey}
                  activeColumn={
                    masterCell?.rowIndex === originalIndex ? masterCell.column : undefined
                  }
                  rowHeight={rowHeight}
                  stripedRows={workspace.stripedRows}
                  fontSize={(workspace.resultFontSize * uiScale) / 100}
                  columnScale={columnScale}
                  columnWindow={dataColumnWindow}
                  columns={columns}
                  onInspect={onInspect}
                  measureElement={rowVirtualizer.measureElement}
                />
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
