import { useSortable } from "@dnd-kit/react/sortable";
import { flexRender, type Header, type OnChangeFn, type SortingState } from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeOffIcon,
  FilterIcon,
  GripVerticalIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OPERATORS, operatorNeedsValue } from "@/lib/sql-filter";
import { cn } from "@/lib/utils";

type DataTableHeaderCellProps = {
  header: Header<Record<string, unknown>, unknown>;
  sortableIndex: number;
  isFetching: boolean;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  filterOperator: string;
  onFilterOperatorChange: (value: string) => void;
  filterValue: string;
  onFilterValueChange: (value: string) => void;
  compiledFilter: string;
  onApplyFilter?: (where: string, isRaw: boolean) => void;
  onApplyColumnFilter: () => void;
  onHideColumn: () => void;
  canHide: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
};

export function DataTableHeaderCell({
  header,
  sortableIndex,
  isFetching,
  sorting,
  onSortingChange,
  filterOpen,
  onFilterOpenChange,
  filterOperator,
  onFilterOperatorChange,
  filterValue,
  onFilterValueChange,
  compiledFilter,
  onApplyFilter,
  onApplyColumnFilter,
  onHideColumn,
  canHide,
  isPinned,
  onTogglePin,
}: DataTableHeaderCellProps) {
  const { ref, handleRef, isDragging } = useSortable({ id: header.id, index: sortableIndex });
  const pinnedOffset =
    header.column.getIsPinned() === "left" ? header.column.getStart("left") : null;

  return (
    <ContextMenu>
      <Popover open={filterOpen} onOpenChange={onFilterOpenChange}>
        <PopoverAnchor asChild>
          <ContextMenuTrigger asChild>
            <th
              ref={ref}
              data-column-id={header.id}
              className={cn(
                "relative border-b border-r border-border bg-muted px-3 py-2 text-left align-middle",
                pinnedOffset !== null && "sticky z-30 bg-muted shadow-[1px_0_0_0_var(--border)]",
                isDragging && "z-40 opacity-80",
              )}
              style={{ width: header.getSize(), left: pinnedOffset ?? undefined }}
            >
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  ref={handleRef}
                  aria-label={`${header.id} verschieben`}
                  className="shrink-0 -ml-1 cursor-grab touch-none rounded p-0.5 text-muted-foreground/35 hover:text-muted-foreground active:cursor-grabbing"
                >
                  <GripVerticalIcon className="size-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </div>
              </div>
              {header.column.getCanResize() && (
                <div
                  onDoubleClick={() => header.column.resetSize()}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    header.getResizeHandler()(event);
                  }}
                  onTouchStart={(event) => {
                    event.stopPropagation();
                    header.getResizeHandler()(event);
                  }}
                  className={cn(
                    "absolute -right-px top-0 z-40 h-full w-2 cursor-col-resize select-none touch-none",
                    header.column.getIsResizing()
                      ? "bg-primary"
                      : "bg-transparent hover:bg-primary/30",
                  )}
                />
              )}
            </th>
          </ContextMenuTrigger>
        </PopoverAnchor>
        {onApplyFilter && (
          <PopoverContent
            align="start"
            sideOffset={4}
            className="w-80 p-0 gap-0"
            onFocusOutside={(event) => event.preventDefault()}
          >
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <FilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-mono text-[12px] font-semibold text-foreground/80 truncate">
                {header.id}
              </span>
            </div>
            <div className="space-y-2 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 shrink-0 text-xs text-muted-foreground">Wo</span>
                <Select value={filterOperator} onValueChange={onFilterOperatorChange}>
                  <SelectTrigger size="sm" className="min-w-44 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {OPERATORS.map((op) => (
                      <SelectItem key={op.key} value={op.key}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {operatorNeedsValue(filterOperator) ? (
                  <Input
                    value={filterValue}
                    onChange={(event) => onFilterValueChange(event.target.value)}
                    placeholder="Wert"
                    autoFocus
                    className="h-8 w-full min-w-0"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onApplyColumnFilter();
                    }}
                  />
                ) : (
                  <div className="w-full" />
                )}
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {compiledFilter !== "" ? `WHERE ${compiledFilter}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onFilterOpenChange(false)}
              >
                <RotateCcwIcon />
                Abbrechen
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onApplyColumnFilter}
                disabled={operatorNeedsValue(filterOperator) && filterValue.trim() === ""}
              >
                <PlayIcon />
                Filter anwenden
              </Button>
            </div>
          </PopoverContent>
        )}
      </Popover>
      <ContextMenuContent>
        <ContextMenuLabel className="font-mono text-[11px]">{header.id}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onSortingChange([{ id: header.id, desc: false }])}
          disabled={isFetching}
        >
          <ArrowUpIcon />
          Aufsteigend sortieren
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onSortingChange([{ id: header.id, desc: true }])}
          disabled={isFetching}
        >
          <ArrowDownIcon />
          Absteigend sortieren
        </ContextMenuItem>
        {sorting.length > 0 && (
          <ContextMenuItem onClick={() => onSortingChange([])}>
            <XIcon />
            Sortierung entfernen
          </ContextMenuItem>
        )}
        {onApplyFilter && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                requestAnimationFrame(() => {
                  onFilterOpenChange(true);
                  onFilterOperatorChange("eq");
                  onFilterValueChange("");
                });
              }}
            >
              <FilterIcon />
              Filter setzen…
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onTogglePin}>
          {isPinned ? <PinOffIcon /> : <PinIcon />}
          {isPinned ? "Fixierung aufheben" : "Spalte links fixieren"}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canHide} onClick={onHideColumn}>
          <EyeOffIcon />
          Spalte ausblenden
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
