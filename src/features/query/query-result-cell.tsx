import { memo } from "react";
import { useMasterDetail } from "@/lib/master-detail";
import { resultCellText } from "@/lib/result-grid";
import { cellPreviewLimit, truncateCellPreview } from "@/lib/table-cell-preview";
import { cn } from "@/lib/utils";

type QueryResultCellProps = {
  column: string;
  value: unknown;
  rowIndex: number;
  originalIndex: number;
  selectionKey: string | null;
  active: boolean;
  fontSize: number;
  width: number;
  onInspect?: (column: string, value: unknown, row: number) => void;
};

export const QueryResultCell = memo(function QueryResultCell({
  column,
  value,
  rowIndex,
  originalIndex,
  selectionKey,
  active,
  fontSize,
  width,
  onInspect,
}: QueryResultCellProps) {
  const isNull = value === null || value === undefined;
  const text = resultCellText(value);
  const display = isNull ? "NULL" : truncateCellPreview(text, cellPreviewLimit(width, fontSize));
  const selectMaster = () => {
    if (selectionKey)
      useMasterDetail.getState().selectCell(selectionKey, {
        column,
        rowIndex: originalIndex,
        value,
      });
  };
  return (
    <td
      tabIndex={selectionKey ? 0 : undefined}
      onFocus={selectMaster}
      onClick={selectMaster}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMaster();
        }
      }}
      data-col={column}
      style={{ fontSize: `${fontSize}px` }}
      title={isNull ? undefined : onInspect ? display : text}
      className={cn(
        active && "ring-1 ring-inset ring-primary bg-primary/10",
        "max-w-xs overflow-hidden text-ellipsis whitespace-nowrap border-b border-r px-3 py-[calc(var(--ui-cell-padding)-0.125rem)] font-mono",
        isNull && "text-muted-foreground/50 italic",
      )}
    >
      {onInspect ? (
        <button
          type="button"
          className="block w-full truncate text-left focus-visible:outline-2 focus-visible:outline-ring"
          title="Vollständigen Zellwert anzeigen"
          onClick={() => onInspect(column, value, rowIndex + 1)}
        >
          {display}
        </button>
      ) : (
        display
      )}
    </td>
  );
});
