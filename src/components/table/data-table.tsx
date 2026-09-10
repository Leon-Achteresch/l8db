import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type ColumnDef,
  type HeaderContext,
  type OnChangeFn,
  type Row,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BinaryIcon,
  BracesIcon,
  CalendarIcon,
  CheckIcon,
  ChevronFirstIcon,
  ChevronLastIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DatabaseIcon,
  FilterIcon,
  FingerprintIcon,
  HashIcon,
  KeyIcon,
  Loader2Icon,
  Maximize2Icon,
  PlayIcon,
  RotateCcwIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { OPERATORS, compileSingleCondition, operatorNeedsValue } from "@/lib/sql-filter";
import { cn } from "@/lib/utils";

type TableRow = Record<string, unknown>;

const INDEX_COLUMN = "__row_index__";

function renderTypeIcon(iconName: string, className?: string) {
  switch (iconName) {
    case "Key":
      return <KeyIcon className={className} />;
    case "Fingerprint":
      return <FingerprintIcon className={className} />;
    case "Hash":
      return <HashIcon className={className} />;
    case "Binary":
      return <BinaryIcon className={className} />;
    case "Calendar":
      return <CalendarIcon className={className} />;
    case "Braces":
      return <BracesIcon className={className} />;
    default:
      return <TypeIcon className={className} />;
  }
}

function getColumnTypeInfo(col: string, rows: TableRow[]) {
  const nonNull = rows
    .map((r) => r[col])
    .filter((v) => v !== null && v !== undefined);

  let type: "text" | "number" | "boolean" | "date" | "json" | "key" | "uuid" = "text";

  if (col.toLowerCase() === "id" || col.toLowerCase() === "uuid") {
    type = col.toLowerCase() === "id" ? "key" : "uuid";
  } else if (nonNull.length === 0) {
    if (col.toLowerCase().endsWith("_id") || col.toLowerCase().endsWith("id")) {
      type = "key";
    } else {
      type = "text";
    }
  } else {
    const first = nonNull[0];
    if (typeof first === "boolean") {
      type = "boolean";
    } else if (typeof first === "number") {
      type = "number";
    } else if (typeof first === "object") {
      type = "json";
    } else if (typeof first === "string") {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first)) {
        type = "uuid";
      } else if (!isNaN(Date.parse(first)) && (first.includes("-") || first.includes("T") || first.includes(":"))) {
        type = "date";
      } else if (col.toLowerCase().endsWith("_id") || col.toLowerCase().endsWith("id")) {
        type = "key";
      }
    }
  }

  switch (type) {
    case "key":
      return {
        label: "id",
        align: "text-left" as const,
        colorClass: "text-amber-500 bg-amber-500/10 border-amber-500/20",
        iconName: "Key",
      };
    case "uuid":
      return {
        label: "uuid",
        align: "text-left" as const,
        colorClass: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
        iconName: "Fingerprint",
      };
    case "number":
      return {
        label: "num",
        align: "text-left" as const,
        colorClass: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
        iconName: "Hash",
      };
    case "boolean":
      return {
        label: "bool",
        align: "text-left" as const,
        colorClass: "text-sky-500 bg-sky-500/10 border-sky-500/20",
        iconName: "Binary",
      };
    case "date":
      return {
        label: "date",
        align: "text-left" as const,
        colorClass: "text-rose-500 bg-rose-500/10 border-rose-500/20",
        iconName: "Calendar",
      };
    case "json":
      return {
        label: "json",
        align: "text-left" as const,
        colorClass: "text-purple-500 bg-purple-500/10 border-purple-500/20",
        iconName: "Braces",
      };
    case "text":
      return {
        label: "text",
        align: "text-left" as const,
        colorClass: "text-slate-500 bg-slate-500/10 border-slate-500/20",
        iconName: "Type",
      };
  }
}

function renderValue(value: unknown) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/10 select-none">
        NULL
      </span>
    );
  }
  if (typeof value === "boolean") {
    return value ? (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 select-none">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        true
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 select-none">
        <span className="size-1.5 rounded-full bg-rose-500" />
        false
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span className="font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "object") {
    const isArray = Array.isArray(value);
    const label = isArray ? `Array(${value.length})` : "Object";
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 max-w-full truncate select-none">
        <span className="text-[10px] uppercase font-bold tracking-wide">
          {isArray ? "[]" : "{}"}
        </span>
        <span className="truncate">{label}</span>
      </span>
    );
  }

  const str = String(value);
  if (str.length >= 10 && !isNaN(Date.parse(str)) && (str.includes("-") || str.includes("T") || str.includes(":"))) {
    return (
      <span className="font-mono text-[12px] text-rose-600 dark:text-rose-400 bg-rose-500/[0.03] px-1 py-0.5 rounded border border-rose-500/5">
        {str}
      </span>
    );
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return (
      <span className="font-mono text-[12px] text-amber-600 dark:text-amber-400 bg-amber-500/[0.03] px-1 py-0.5 rounded border border-amber-500/5">
        {str}
      </span>
    );
  }

  return <span className="font-mono text-[13px] text-foreground/90">{str}</span>;
}

type EditingRow = {
  ctid: string;
  values: Record<string, string>;
};

type DataTableProps = {
  columns: string[];
  data: TableRow[];
  emptyMessage: string;
  className?: string;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  isFetching?: boolean;
  onSaveRow?: (ctid: string, updates: Record<string, string | null>) => Promise<void>;
  onApplyFilter?: (where: string) => void;
  page?: number;
  totalCount?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
};

export function DataTable({
  columns: columnNames,
  data,
  emptyMessage,
  className,
  sorting,
  onSortingChange,
  isFetching = false,
  onSaveRow,
  onApplyFilter,
  page = 0,
  totalCount,
  pageSize = 100,
  onPageChange,
}: DataTableProps) {
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; columnId: string } | null>(null);
  const [inspectCell, setInspectCell] = useState<{ columnName: string; value: unknown } | null>(null);
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [filterOperator, setFilterOperator] = useState("eq");
  const [filterValue, setFilterValue] = useState("");
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        id: INDEX_COLUMN,
        header: () => (
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase select-none">
            #
          </span>
        ),
        enableSorting: false,
        enableResizing: false,
        cell: (info) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground/60 select-none">
            {info.row.index + 1 + page * pageSize}
          </span>
        ),
        size: 48,
      },
      ...columnNames.map(
        (column): ColumnDef<TableRow> => ({
          accessorKey: column,
          size: 200,
          minSize: 80,
          maxSize: 850,
          header: ({ column: col }: HeaderContext<TableRow, unknown>) => {
            const typeInfo = getColumnTypeInfo(column, data);
            const sorted = col.getIsSorted();
            return (
              <div className="flex items-center gap-2 w-full min-w-0 justify-start">
                <button
                  type="button"
                  onClick={col.getToggleSortingHandler()}
                  disabled={isFetching}
                  className="group flex items-center gap-1 rounded-sm px-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer min-w-0 shrink"
                >
                  <span className="truncate font-mono font-semibold text-[12px] tracking-tight text-foreground/80">
                    {column}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-muted-foreground transition-colors",
                      sorted ? "text-primary" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    {sorted === "asc" ? (
                      <ArrowUpIcon className="size-3" />
                    ) : sorted === "desc" ? (
                      <ArrowDownIcon className="size-3" />
                    ) : (
                      <ArrowUpDownIcon className="size-3 text-muted-foreground/45" />
                    )}
                  </span>
                </button>
                <div className="ml-auto flex shrink-0 items-center">
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded border px-1 py-[1px] text-[9px] font-mono leading-none tracking-wider uppercase font-semibold select-none whitespace-nowrap",
                      typeInfo.colorClass
                    )}
                  >
                    {renderTypeIcon(typeInfo.iconName, "size-2.5")}
                    <span>{typeInfo.label}</span>
                  </div>
                </div>
              </div>
            );
          },
          cell: (info) => {
            const value = info.getValue();
            return (
              <div className="truncate text-left">
                {renderValue(value)}
              </div>
            );
          },
        }),
      ),
    ],
    [columnNames, isFetching, data, page, pageSize],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    columnResizeMode: "onChange",
    getRowId: (row, index) => {
      const ctid = row["__ctid__"] as string | undefined;
      return ctid ?? `row-${index}`;
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const colSpan = table.getAllColumns().length || 1;
  const activeSort = sorting[0];

  const handleSaveRow = useCallback(async () => {
    if (!editingRow || !onSaveRow || isSaving) return;
    setIsSaving(true);
    try {
      const updates: Record<string, string | null> = {};
      for (const [col, val] of Object.entries(editingRow.values)) {
        updates[col] = val === "" ? null : val;
      }
      await onSaveRow(editingRow.ctid, updates);
      setEditingRow(null);
      toast.success("Zeile gespeichert.");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [editingRow, onSaveRow, isSaving]);

  const handleCancelEdit = useCallback(() => {
    setEditingRow(null);
  }, []);

  const applyColumnFilter = useCallback(() => {
    if (!filterColumn || !onApplyFilter) return;
    const sql = compileSingleCondition(filterColumn, filterOperator, filterValue);
    if (sql) {
      onApplyFilter(sql);
    }
    setFilterColumn(null);
  }, [filterColumn, filterOperator, filterValue, onApplyFilter]);

  const compiledFilter = useMemo(
    () => (filterColumn ? (compileSingleCondition(filterColumn, filterOperator, filterValue) ?? "") : ""),
    [filterColumn, filterOperator, filterValue],
  );

  const handleRowDoubleClick = useCallback(
    (row: Row<TableRow>) => {
      const ctid = row.original["__ctid__"] as string | undefined;
      if (!ctid) return;
      const values: Record<string, string> = {};
      for (const col of columnNames) {
        const val = row.original[col];
        if (val === null || val === undefined) {
          values[col] = "";
        } else if (typeof val === "object") {
          values[col] = JSON.stringify(val);
        } else {
          values[col] = String(val);
        }
      }
      setEditingRow({ ctid, values });
      setActiveCell(null);
    },
    [columnNames],
  );

  useEffect(() => {
    if (!editingRow || !tbodyRef.current) return;
    requestAnimationFrame(() => {
      const tbody = tbodyRef.current;
      if (!tbody) return;
      const tr = Array.from(tbody.children).find(
        (child) =>
          child instanceof HTMLTableRowElement &&
          child.dataset.ctid === editingRow.ctid,
      );
      if (tr instanceof HTMLTableRowElement) {
        tr.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }, [editingRow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingRow) {
        if (e.key === "Escape") {
          setEditingRow(null);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void handleSaveRow();
          return;
        }
        return;
      }

      if (!activeCell) return;
      const { rowIndex, columnId } = activeCell;
      const colIndex = columnNames.indexOf(columnId);

      if (e.key === "Escape") {
        setActiveCell(null);
        return;
      }

      let nextRowIndex = rowIndex;
      let nextColIndex = colIndex;

      if (e.key === "ArrowUp") {
        nextRowIndex = Math.max(0, rowIndex - 1);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        nextColIndex = Math.max(-1, colIndex - 1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        nextColIndex = Math.min(columnNames.length - 1, colIndex + 1);
        e.preventDefault();
      }

      const nextColumnId = nextColIndex === -1 ? INDEX_COLUMN : columnNames[nextColIndex];
      if (nextRowIndex !== rowIndex || nextColumnId !== columnId) {
        setActiveCell({ rowIndex: nextRowIndex, columnId: nextColumnId });
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        if (columnId === INDEX_COLUMN) return;
        const row = rows[rowIndex];
        const val = row?.getValue(columnId);
        if (val !== undefined) {
          const stringVal = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
          void navigator.clipboard.writeText(stringVal);
          toast.success("Wert in die Zwischenablage kopiert!");
          e.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeCell, columnNames, rows, editingRow, handleSaveRow]);

  const handleCellCopy = (val: unknown) => {
    if (val === undefined || val === null) return;
    const stringVal = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
    void navigator.clipboard.writeText(stringVal);
    toast.success("In die Zwischenablage kopiert!");
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col relative", className)}>
      {isFetching && (
        <div className="absolute top-0 left-0 right-0 z-50 h-0.5 w-full bg-primary/20 overflow-hidden">
          <div className="h-full w-1/3 bg-primary animate-pulse rounded-full" />
        </div>
      )}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-auto transition-opacity",
          isFetching && "opacity-85",
          table.getState().columnSizingInfo.isResizingColumn && "cursor-col-resize select-none",
        )}
      >
        <table className="min-w-full border-separate border-spacing-0 text-sm table-fixed" style={{ width: table.getTotalSize() }}>
          <thead className="sticky top-0 z-10 select-none">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => (
                  <ContextMenu key={header.id}>
                    <Popover
                      open={filterColumn === header.id}
                      onOpenChange={(open) => { if (!open) setFilterColumn(null); }}
                    >
                      <PopoverAnchor asChild>
                        <ContextMenuTrigger asChild>
                          <th
                            className={cn(
                              "border-b border-r border-border bg-muted/80 px-3 py-2 text-left align-middle backdrop-blur-md shadow-xs relative",
                              index === 0 && "w-12 sticky left-0 z-30 border-r border-border text-center bg-muted/95",
                            )}
                            style={{ width: header.getSize() }}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext(),
                                )}
                            {header.column.getCanResize() && (
                              <div
                                onDoubleClick={() => header.column.resetSize()}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  header.getResizeHandler()(e);
                                }}
                                onTouchStart={(e) => {
                                  e.stopPropagation();
                                  header.getResizeHandler()(e);
                                }}
                                className={cn(
                                  "absolute -right-px top-0 z-40 h-full w-2 cursor-col-resize select-none touch-none",
                                  header.column.getIsResizing() ? "bg-primary" : "bg-transparent hover:bg-primary/30",
                                )}
                              />
                            )}
                          </th>
                        </ContextMenuTrigger>
                      </PopoverAnchor>
                      {index > 0 && onApplyFilter && (
                        <PopoverContent align="start" sideOffset={4} className="w-80 p-0 gap-0">
                          <div className="flex items-center gap-2 border-b px-3 py-2">
                            <FilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-mono text-[12px] font-semibold text-foreground/80 truncate">{header.id}</span>
                          </div>
                          <div className="space-y-2 px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="shrink-0 text-xs text-muted-foreground w-6">Wo</span>
                              <NativeSelect
                                size="sm"
                                value={filterOperator}
                                onChange={(e) => setFilterOperator(e.target.value)}
                                className="min-w-44 flex-1"
                              >
                                {OPERATORS.map((op) => (
                                  <NativeSelectOption key={op.key} value={op.key}>
                                    {op.label}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                              {operatorNeedsValue(filterOperator) ? (
                                <Input
                                  value={filterValue}
                                  onChange={(e) => setFilterValue(e.target.value)}
                                  placeholder="Wert"
                                  autoFocus
                                  className="h-8 w-full min-w-0"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") applyColumnFilter();
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
                              onClick={() => setFilterColumn(null)}
                            >
                              <RotateCcwIcon />
                              Abbrechen
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={applyColumnFilter}
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
                      {index > 0 && (
                        <>
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
                                onClick={() => {
                                  setFilterColumn(header.id);
                                  setFilterOperator("eq");
                                  setFilterValue("");
                                }}
                              >
                                <FilterIcon />
                                Filter setzen…
                              </ContextMenuItem>
                            </>
                          )}
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </tr>
            ))}
          </thead>
          <tbody ref={tbodyRef}>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-3 py-16 text-center text-muted-foreground bg-background"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const rowIndex = row.index;
                const rowCtid = row.original["__ctid__"] as string | undefined;
                const isEditing = !!rowCtid && editingRow?.ctid === rowCtid;
                const beginCellEdit = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (!onSaveRow || isEditing) return;
                  handleRowDoubleClick(row);
                };

                return (
                  <tr
                    key={rowCtid ?? row.id}
                    data-row-index={rowIndex}
                    data-ctid={rowCtid}
                    className={cn(
                      "group/row",
                      isEditing
                        ? "bg-primary/[0.03]"
                        : "bg-background hover:bg-muted/15",
                    )}
                  >
                    {row.getVisibleCells().map((cell, cellIndex) => {
                      const columnId = cell.column.id;
                      const value =
                        cellIndex > 0 ? row.getValue(columnId) : undefined;
                      const isActive =
                        !isEditing &&
                        activeCell?.rowIndex === rowIndex &&
                        activeCell.columnId === columnId;

                      if (isEditing) {
                        if (cellIndex === 0) {
                          return (
                            <td
                              key={cell.id}
                              style={{ width: cell.column.getSize() }}
                              className="w-12 border-b border-r border-border sticky left-0 z-10 bg-primary/[0.06] text-center px-1 py-1"
                            >
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60 select-none leading-none">
                                  {rowIndex + 1}
                                </span>
                                <div className="flex items-center justify-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => void handleSaveRow()}
                                  disabled={isSaving}
                                  title="Speichern (Enter)"
                                  className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {isSaving ? (
                                    <Loader2Icon className="size-3.5 animate-spin" />
                                  ) : (
                                    <CheckIcon className="size-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEdit}
                                  disabled={isSaving}
                                  title="Abbrechen (Esc)"
                                  className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  <XIcon className="size-3.5" />
                                </button>
                                </div>
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className="px-3 py-0 align-middle border-b border-r border-border/30 relative overflow-hidden"
                          >
                            <input
                              type="text"
                              value={editingRow.values[columnId] ?? ""}
                              onChange={(e) =>
                                setEditingRow((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        values: { ...prev.values, [columnId]: e.target.value },
                                      }
                                    : prev,
                                )
                              }
                              disabled={isSaving}
                              placeholder="NULL"
                              autoFocus={cellIndex === 1}
                              className="w-full min-w-0 h-8 bg-transparent font-mono text-[13px] text-foreground outline-none border-0 focus:ring-0 placeholder:text-muted-foreground/35 disabled:opacity-60"
                            />
                          </td>
                        );
                      }

                      return (
                        <td
                          key={cell.id}
                          onClick={() => setActiveCell({ rowIndex, columnId })}
                          onDoubleClick={onSaveRow ? beginCellEdit : undefined}
                          style={{ width: cell.column.getSize() }}
                          className={cn(
                            "px-3 py-1.5 align-middle border-b border-r border-border/30 transition-colors select-text relative cursor-default text-left overflow-hidden",
                            cellIndex === 0 &&
                              "w-12 border-r border-border sticky left-0 z-10 bg-muted/40 group-hover/row:bg-muted/65 text-center text-muted-foreground/50 select-none font-mono text-xs",
                            isActive && "bg-primary/[0.03] outline outline-2 outline-inset -outline-offset-2 outline-primary/70 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.1)] z-10",
                            !isActive && cellIndex > 0 && "hover:bg-muted/10",
                          )}
                        >
                          <div className="relative flex items-center justify-between gap-2 w-full h-full text-left">
                            <div className="min-w-0 flex-1 truncate text-left">
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </div>
                            {isActive && cellIndex > 0 && (
                              <div className="absolute right-0 flex items-center gap-0.5 bg-background/90 backdrop-blur-xs pl-1 py-0.5 rounded shadow-sm border border-border/80 z-20">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCellCopy(value);
                                  }}
                                  title="Kopieren"
                                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                >
                                  <CopyIcon className="size-3" />
                                </button>
                                {value !== null && (typeof value === "object" || (typeof value === "string" && value.length > 50)) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setInspectCell({ columnName: columnId, value });
                                    }}
                                    title="Anzeigen"
                                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                  >
                                    <Maximize2Icon className="size-3" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (() => {
        const totalPages = totalCount != null ? Math.ceil(totalCount / pageSize) : undefined;
        const rangeStart = page * pageSize + 1;
        const rangeEnd = page * pageSize + rows.length;
        return (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground select-none">
          <span>
            {totalCount != null
              ? `${rangeStart}–${rangeEnd} von ${totalCount}`
              : `${rows.length} ${rows.length === 1 ? "Zeile" : "Zeilen"}`}
          </span>
          {isFetching ? (
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
              {onSaveRow
                ? "Navigiere mit Pfeiltasten · Doppelklick zum Bearbeiten"
                : "Navigiere mit Pfeiltasten · Doppelklick zum Kopieren"}
            </span>
          )}
          {onPageChange && totalPages != null && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <span className="mr-1">Seite {page + 1} / {totalPages}</span>
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
        );
      })()}

      {inspectCell && (
        <Dialog open={true} onOpenChange={() => setInspectCell(null)}>
          <DialogContent className="max-w-2xl sm:max-w-2xl border border-border bg-popover shadow-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <DatabaseIcon className="size-4 text-primary" />
                Spalte: <span className="font-mono text-primary font-bold">{inspectCell.columnName}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 my-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Zellendetails</span>
                <button
                  type="button"
                  onClick={() => {
                    const stringVal = typeof inspectCell.value === "object" ? JSON.stringify(inspectCell.value, null, 2) : String(inspectCell.value);
                    void navigator.clipboard.writeText(stringVal);
                    toast.success("Kopiert!");
                  }}
                  className="h-7 text-xs gap-1.5 flex items-center justify-center rounded-md border border-input bg-background px-3 font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                >
                  <CopyIcon className="size-3.5" />
                  Kopieren
                </button>
              </div>
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-border/80 bg-muted/45 p-4 font-mono text-xs leading-relaxed shadow-inner">
                {typeof inspectCell.value === "object" && inspectCell.value !== null ? (
                  <pre className="text-purple-600 dark:text-purple-400 whitespace-pre-wrap [word-break:break-word]">
                    {JSON.stringify(inspectCell.value, null, 2)}
                  </pre>
                ) : (
                  <pre className="text-foreground whitespace-pre-wrap [word-break:break-word]">
                    {String(inspectCell.value)}
                  </pre>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
