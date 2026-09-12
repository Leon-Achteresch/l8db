import { memo } from "react";
import type { ColumnWindowItem } from "@/lib/hooks/use-column-window";
import type { ResultRow } from "@/lib/result-grid";
import { cn } from "@/lib/utils";
import { QueryResultCell } from "./query-result-cell";

type QueryResultRowProps = {
  row: ResultRow;
  rowIdx: number;
  originalIndex: number;
  isMarked: boolean;
  toggleRowMarker: (row: ResultRow) => void;
  selectionKey: string | null;
  activeColumn: string | undefined;
  rowHeight: number;
  stripedRows: boolean;
  fontSize: number;
  columnScale: number;
  columnWindow: ColumnWindowItem[];
  columns: string[];
  onInspect?: (column: string, value: unknown, row: number) => void;
  measureElement: (element: HTMLTableRowElement | null) => void;
};

export const QueryResultRow = memo(function QueryResultRow({
  row,
  rowIdx,
  originalIndex,
  isMarked,
  toggleRowMarker,
  selectionKey,
  activeColumn,
  rowHeight,
  stripedRows,
  fontSize,
  columnScale,
  columnWindow,
  columns,
  onInspect,
  measureElement,
}: QueryResultRowProps) {
  return (
    <tr
      ref={measureElement}
      data-index={rowIdx}
      data-marked={isMarked || undefined}
      style={{
        height: rowHeight,
      }}
      className={cn(
        "group",
        isMarked
          ? "bg-primary/10"
          : stripedRows && rowIdx % 2 !== 0
            ? "bg-muted/20 hover:bg-muted/50"
            : "bg-background hover:bg-muted/50",
      )}
    >
      <td className="sticky left-0 z-10 border-b border-r bg-inherit p-0 text-right font-mono text-xs text-muted-foreground">
        <button
          type="button"
          aria-label={`Zeile ${rowIdx + 1} markieren`}
          aria-pressed={isMarked}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
          title="Zeile markieren / Markierung aufheben"
          onClick={() => toggleRowMarker(row)}
          className={cn(
            "block w-full cursor-pointer px-3 py-[calc(var(--ui-cell-padding)-0.125rem)] text-right tabular-nums focus-visible:outline-2 focus-visible:outline-ring",
            isMarked && "text-primary",
          )}
        >
          {rowIdx + 1}
        </button>
      </td>
      {columnWindow.map((item) => {
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
        return (
          <QueryResultCell
            key={col}
            column={col}
            value={row[col]}
            rowIndex={rowIdx}
            originalIndex={originalIndex}
            selectionKey={selectionKey}
            active={activeColumn === col}
            fontSize={fontSize}
            width={item.width * columnScale}
            onInspect={onInspect}
          />
        );
      })}
    </tr>
  );
});
