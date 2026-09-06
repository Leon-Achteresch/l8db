import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type HeaderContext,
  type OnChangeFn,
  type Row,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BinaryIcon,
  BracesIcon,
  CalendarIcon,
  ChevronFirstIcon,
  ChevronLastIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  CopyPlusIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FingerprintIcon,
  HashIcon,
  KeyIcon,
  LinkIcon,
  Loader2Icon,
  Maximize2Icon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { DataTableColumnSettings } from "@/features/table/data-table-column-settings";
import { DataTableHeaderCell } from "@/features/table/data-table-header-cell";
import { useActiveConnection } from "@/lib/connections";
import { type ForeignKeyInfo, fetchTableRows } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { compileSingleCondition } from "@/lib/sql-filter";
import { effectiveConnectionString } from "@/lib/ssh";
import {
  reorderVisibleColumns,
  toggleHiddenColumn,
  useTableColumnLayout,
} from "@/lib/table-column-prefs";
import { cn } from "@/lib/utils";

const headerSensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: () => false,
  }),
];

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
  const nonNull = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);

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
      } else if (
        !Number.isNaN(Date.parse(first)) &&
        (first.includes("-") || first.includes("T") || first.includes(":"))
      ) {
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
  if (
    str.length >= 10 &&
    !Number.isNaN(Date.parse(str)) &&
    (str.includes("-") || str.includes("T") || str.includes(":"))
  ) {
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

function formatFkFilter(column: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  const escaped = String(value).replace(/'/g, "''");
  if (typeof value === "number") return `"${column}" = ${value}`;
  return `"${column}" = '${escaped}'`;
}

function FkPreviewPopover({
  fk,
  value,
  currentSchema,
  currentTable,
  onNavigate,
  children,
}: {
  fk: ForeignKeyInfo;
  value: unknown;
  currentSchema: string;
  currentTable: string;
  onNavigate: (schema: string, table: string, filter?: string) => void;
  children: React.ReactNode;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const isOutgoing = fk.from_schema === currentSchema && fk.from_table === currentTable;
  const targetSchema = isOutgoing ? fk.to_schema : fk.from_schema;
  const targetTable = isOutgoing ? fk.to_table : fk.from_table;
  const targetColumn = isOutgoing ? fk.to_column : fk.from_column;

  const handleOpenChange = (open: boolean) => {
    if (!open || hasLoaded || !connection || value === null || value === undefined) return;
    setIsLoadingPreview(true);
    setHasLoaded(true);
    const filterSql = formatFkFilter(targetColumn, value);
    fetchTableRows(
      connection.kind,
      effectiveConnectionString(connection),
      targetSchema,
      targetTable,
      filterSql,
      5,
      0,
      database ?? undefined,
    )
      .then((result) => {
        setPreviewColumns(result.columns);
        setPreviewData((result.rows[0] as Record<string, unknown>) ?? null);
      })
      .catch(() => {
        setPreviewData(null);
      })
      .finally(() => setIsLoadingPreview(false));
  };

  const handleCtrlClick = (e: React.MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey) || value === null || value === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const filterSql = formatFkFilter(targetColumn, value);
    onNavigate(targetSchema, targetTable, filterSql);
  };

  if (value === null || value === undefined) {
    return <>{children}</>;
  }

  return (
    <HoverCard openDelay={400} closeDelay={100} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        <div
          onClick={handleCtrlClick}
          className="inline-flex items-center gap-1 min-w-0 max-w-full cursor-pointer group/fk"
        >
          <LinkIcon className="size-3 shrink-0 text-blue-500/60 group-hover/fk:text-blue-500 transition-colors" />
          <div className="truncate">{children}</div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        className="w-auto min-w-72 max-w-[32rem] p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 bg-muted/40">
          <div className="flex items-center gap-1.5 min-w-0">
            <ExternalLinkIcon className="size-3 shrink-0 text-blue-500" />
            <span className="font-mono text-[11px] font-semibold text-foreground/80 truncate">
              {targetSchema}.{targetTable}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
            {isOutgoing ? "FK" : "Referenced by"}
          </span>
        </div>
        <div className="px-3 py-2 max-h-52 overflow-auto">
          {isLoadingPreview ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Lade...
            </div>
          ) : previewData ? (
            <div className="space-y-1">
              {previewColumns.slice(0, 8).map((col) => (
                <div key={col} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 font-mono font-semibold text-muted-foreground w-24 truncate text-right">
                    {col}
                  </span>
                  <span className="min-w-0 truncate">{renderValue(previewData[col])}</span>
                </div>
              ))}
              {previewColumns.length > 8 && (
                <div className="text-[10px] text-muted-foreground pt-1">
                  +{previewColumns.length - 8} weitere Spalten
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Kein Eintrag gefunden.</span>
          )}
        </div>
        <div className="border-t px-3 py-1.5 bg-muted/20">
          <button
            type="button"
            className="text-[11px] text-blue-500 hover:text-blue-600 font-medium cursor-pointer transition-colors"
            onClick={() => {
              const filterSql = formatFkFilter(targetColumn, value);
              onNavigate(targetSchema, targetTable, filterSql);
            }}
          >
            In {targetSchema}.{targetTable} anzeigen
          </button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

type EditingCell = {
  ctid: string;
  rowIndex: number;
  columnId: string;
  value: string;
  originalValues: Record<string, unknown>;
};

type DataTableProps = {
  columns: string[];
  data: TableRow[];
  emptyMessage: string;
  className?: string;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  isFetching?: boolean;
  onSaveRow?: (
    ctid: string,
    updates: Record<string, string | null>,
    oldValues: Record<string, unknown>,
  ) => Promise<void>;
  onApplyFilter?: (where: string, isRaw: boolean) => void;
  page?: number;
  totalCount?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  foreignKeys?: ForeignKeyInfo[];
  currentSchema?: string;
  currentTable?: string;
  onNavigateToTable?: (schema: string, table: string, filter?: string) => void;
  onDuplicateRow?: (ctid: string) => void;
  onDeleteRow?: (ctid: string, oldValues: Record<string, unknown>) => void;
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
  foreignKeys,
  currentSchema,
  currentTable,
  onNavigateToTable,
  onDuplicateRow,
  onDeleteRow,
}: DataTableProps) {
  const connection = useActiveConnection();
  const { order, hidden, setOrder, setHidden, reset, isCustomized } = useTableColumnLayout(
    connection?.id,
    currentSchema,
    currentTable,
    columnNames,
  );
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; columnId: string } | null>(null);
  const [inspectCell, setInspectCell] = useState<{ columnName: string; value: unknown } | null>(
    null,
  );
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [filterOperator, setFilterOperator] = useState("eq");
  const [filterValue, setFilterValue] = useState("");
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const fkByColumn = useMemo(() => {
    if (!foreignKeys || !currentSchema || !currentTable) return new Map<string, ForeignKeyInfo>();
    const map = new Map<string, ForeignKeyInfo>();
    for (const fk of foreignKeys) {
      if (fk.from_schema === currentSchema && fk.from_table === currentTable) {
        map.set(fk.from_column, fk);
      }
      if (fk.to_schema === currentSchema && fk.to_table === currentTable) {
        map.set(fk.to_column, fk);
      }
    }
    return map;
  }, [foreignKeys, currentSchema, currentTable]);

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        id: INDEX_COLUMN,
        header: () => (
          <span
            title="Rechtsklick: Spalten"
            className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase select-none"
          >
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
            const fk = fkByColumn.get(column);
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
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {fk && (
                    <div
                      className="flex items-center gap-0.5 rounded border px-1 py-[1px] text-[9px] font-mono leading-none tracking-wider uppercase font-semibold select-none whitespace-nowrap text-blue-500 bg-blue-500/10 border-blue-500/20"
                      title={
                        fk.from_schema === currentSchema && fk.from_table === currentTable
                          ? `FK -> ${fk.to_schema}.${fk.to_table}.${fk.to_column}`
                          : `<- ${fk.from_schema}.${fk.from_table}.${fk.from_column}`
                      }
                    >
                      <LinkIcon className="size-2.5" />
                      <span>fk</span>
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded border px-1 py-[1px] text-[9px] font-mono leading-none tracking-wider uppercase font-semibold select-none whitespace-nowrap",
                      typeInfo.colorClass,
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
            const fk = fkByColumn.get(column);
            if (fk && onNavigateToTable && currentSchema && currentTable) {
              return (
                <FkPreviewPopover
                  fk={fk}
                  value={value}
                  currentSchema={currentSchema}
                  currentTable={currentTable}
                  onNavigate={onNavigateToTable}
                >
                  <div className="truncate text-left">{renderValue(value)}</div>
                </FkPreviewPopover>
              );
            }
            return <div className="truncate text-left">{renderValue(value)}</div>;
          },
        }),
      ),
    ],
    [
      columnNames,
      isFetching,
      data,
      page,
      pageSize,
      fkByColumn,
      onNavigateToTable,
      currentSchema,
      currentTable,
    ],
  );

  const columnOrder = useMemo(() => [INDEX_COLUMN, ...order], [order]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(hidden.map((column) => [column, false])),
    [hidden],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnOrder, columnVisibility },
    onSortingChange,
    manualSorting: true,
    columnResizeMode: "onChange",
    getRowId: (row, index) => {
      const ctid = row.__ctid__ as string | undefined;
      return ctid ?? `row-${index}`;
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const colSpan = table.getVisibleLeafColumns().length || 1;
  const activeSort = sorting[0];
  const visibleDataColumns = table
    .getVisibleLeafColumns()
    .map((column) => column.id)
    .filter((id) => id !== INDEX_COLUMN);

  const handleSaveCell = useCallback(async () => {
    if (!editingCell || !onSaveRow || isSaving) return;
    setIsSaving(true);
    try {
      const updates: Record<string, string | null> = {};
      for (const col of columnNames) {
        if (col === editingCell.columnId) {
          updates[col] = editingCell.value === "" ? null : editingCell.value;
        } else {
          const origVal = editingCell.originalValues[col];
          if (origVal === null || origVal === undefined) {
            updates[col] = null;
          } else if (typeof origVal === "object") {
            updates[col] = JSON.stringify(origVal);
          } else {
            updates[col] = String(origVal);
          }
        }
      }
      await onSaveRow(editingCell.ctid, updates, editingCell.originalValues);
      setEditingCell(null);
      toast.success("Zeile gespeichert.");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [editingCell, onSaveRow, isSaving, columnNames]);

  const applyColumnFilter = useCallback(() => {
    if (!filterColumn || !onApplyFilter) return;
    const sql = compileSingleCondition(filterColumn, filterOperator, filterValue);
    if (sql) {
      onApplyFilter(sql, false);
    }
    setFilterColumn(null);
  }, [filterColumn, filterOperator, filterValue, onApplyFilter]);

  const compiledFilter = useMemo(
    () =>
      filterColumn ? (compileSingleCondition(filterColumn, filterOperator, filterValue) ?? "") : "",
    [filterColumn, filterOperator, filterValue],
  );

  const handleCellEdit = useCallback((row: Row<TableRow>, columnId: string) => {
    const ctid = row.original.__ctid__ as string | undefined;
    if (!ctid) return;
    const val = row.original[columnId];
    let value: string;
    if (val === null || val === undefined) {
      value = "";
    } else if (typeof val === "object") {
      value = JSON.stringify(val);
    } else {
      value = String(val);
    }
    setEditingCell({
      ctid,
      rowIndex: row.index,
      columnId,
      value,
      originalValues: { ...row.original },
    });
    setActiveCell(null);
  }, []);

  useEffect(() => {
    if (!editingCell || !tbodyRef.current) return;
    requestAnimationFrame(() => {
      const tbody = tbodyRef.current;
      if (!tbody) return;
      const tr = Array.from(tbody.children).find(
        (child) => child instanceof HTMLTableRowElement && child.dataset.ctid === editingCell.ctid,
      );
      if (tr instanceof HTMLTableRowElement) {
        tr.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }, [editingCell]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingCell) {
        if (e.key === "Escape") {
          setEditingCell(null);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void handleSaveCell();
          return;
        }
        return;
      }

      if (!activeCell) return;
      const { rowIndex, columnId } = activeCell;
      const colIndex = visibleDataColumns.indexOf(columnId);

      if (e.key === "Escape") {
        setActiveCell(null);
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && onSaveRow && columnId !== INDEX_COLUMN) {
        e.preventDefault();
        const row = rows[rowIndex];
        if (row) handleCellEdit(row, columnId);
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
        nextColIndex = Math.min(visibleDataColumns.length - 1, colIndex + 1);
        e.preventDefault();
      }

      const nextColumnId = nextColIndex === -1 ? INDEX_COLUMN : visibleDataColumns[nextColIndex];
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
  }, [activeCell, visibleDataColumns, rows, editingCell, handleSaveCell, onSaveRow, handleCellEdit]);

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
          "relative min-h-0 flex-1 basis-0 overflow-auto [scrollbar-gutter:stable] transition-opacity",
          isFetching && "opacity-85",
          table.getState().columnSizingInfo.isResizingColumn && "cursor-col-resize select-none",
        )}
      >
        <div className="pb-3">
          <DragDropProvider
            sensors={headerSensors}
            onDragEnd={(event) => {
              const { operation, canceled } = event;
              if (canceled || !isSortable(operation.source)) return;
              const source = operation.source;
              if (source.initialIndex === source.index) return;
              setOrder(reorderVisibleColumns(order, hidden, source.initialIndex, source.index));
            }}
          >
          <table
            className="min-w-full border-separate border-spacing-0 text-sm table-fixed"
            style={{ width: table.getTotalSize() }}
          >
            <thead className="sticky top-0 z-10 select-none">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers
                    .filter((header) => header.column.getIsVisible())
                    .map((header) => {
                      if (header.id === INDEX_COLUMN) {
                        return (
                          <ContextMenu key={header.id}>
                            <ContextMenuTrigger asChild>
                              <th
                                title="Rechtsklick: Spalten"
                                className="w-12 sticky left-0 z-30 border-b border-r border-border bg-muted/95 px-3 py-2 text-center align-middle backdrop-blur-md shadow-xs"
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
                                isCustomized={isCustomized}
                                onToggle={(column) =>
                                  setHidden(toggleHiddenColumn(order, hidden, column))
                                }
                                onReorder={setOrder}
                                onReset={reset}
                                onShowAll={() => setHidden([])}
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
                          compiledFilter={
                            filterColumn === header.id ? compiledFilter : ""
                          }
                          onApplyFilter={onApplyFilter}
                          onApplyColumnFilter={applyColumnFilter}
                          onHideColumn={() =>
                            setHidden(toggleHiddenColumn(order, hidden, header.id))
                          }
                          canHide={visibleDataColumns.length > 1}
                        />
                      );
                    })}
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
                  const rowCtid = row.original.__ctid__ as string | undefined;
                  const isRowEditing = !!rowCtid && editingCell?.ctid === rowCtid;
                  const hasRowActions = !!rowCtid && (!!onDuplicateRow || !!onDeleteRow);

                  const rowEl = (
                    <tr
                      key={rowCtid ?? row.id}
                      data-row-index={rowIndex}
                      data-ctid={rowCtid}
                      className={cn(
                        "group/row",
                        isRowEditing ? "bg-primary/[0.03]" : "bg-background hover:bg-muted/15",
                      )}
                    >
                      {row.getVisibleCells().map((cell, cellIndex) => {
                        const columnId = cell.column.id;
                        const value = cellIndex > 0 ? row.getValue(columnId) : undefined;
                        const isCellEditing = isRowEditing && editingCell?.columnId === columnId;
                        const isActive =
                          !isRowEditing &&
                          activeCell?.rowIndex === rowIndex &&
                          activeCell.columnId === columnId;

                        if (isCellEditing && editingCell) {
                          return (
                            <td
                              key={cell.id}
                              style={{ width: cell.column.getSize() }}
                              className="px-0 py-0 align-top border-b border-r border-primary/40 relative overflow-visible bg-primary/[0.04]"
                            >
                              <div className="flex flex-col">
                                <input
                                  type="text"
                                  value={editingCell.value}
                                  onChange={(e) =>
                                    setEditingCell((prev) =>
                                      prev ? { ...prev, value: e.target.value } : prev,
                                    )
                                  }
                                  disabled={isSaving}
                                  placeholder="NULL"
                                  className="w-full min-w-0 h-8 px-3 bg-transparent font-mono text-[13px] text-foreground outline-none border-0 focus:ring-0 placeholder:text-muted-foreground/35 disabled:opacity-60"
                                />
                                <div className="flex items-center gap-3 border-t border-border/40 px-3 py-1 text-[11px] text-muted-foreground select-none">
                                  <span className="flex items-center gap-1">
                                    <kbd className="rounded border border-border bg-muted/80 px-1 py-px font-mono text-[10px] leading-none">
                                      ↵
                                    </kbd>
                                    <span>Speichern</span>
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <kbd className="rounded border border-border bg-muted/80 px-1 py-px font-mono text-[10px] leading-none">
                                      esc
                                    </kbd>
                                    <span>Abbrechen</span>
                                  </span>
                                </div>
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={cell.id}
                            onClick={() => {
                              if (editingCell) setEditingCell(null);
                              setActiveCell({ rowIndex, columnId });
                            }}
                            onDoubleClick={
                              onSaveRow && cellIndex > 0
                                ? (e) => {
                                    e.stopPropagation();
                                    handleCellEdit(row, columnId);
                                  }
                                : undefined
                            }
                            style={{ width: cell.column.getSize() }}
                            className={cn(
                              "px-3 py-1.5 align-middle border-b border-r border-border/30 transition-colors select-text relative cursor-default text-left overflow-hidden",
                              cellIndex === 0 &&
                                "w-12 border-r border-border sticky left-0 z-10 bg-muted/40 group-hover/row:bg-muted/65 text-center text-muted-foreground/50 select-none font-mono text-xs",
                              isActive &&
                                "bg-primary/[0.03] outline outline-2 outline-inset -outline-offset-2 outline-primary/70 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.1)] z-10",
                              !isActive && cellIndex > 0 && "hover:bg-muted/10",
                            )}
                          >
                            <div className="relative flex items-center justify-between gap-2 w-full h-full text-left">
                              <div className="min-w-0 flex-1 truncate text-left">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
                                  {value !== null &&
                                    (typeof value === "object" ||
                                      (typeof value === "string" && value.length > 50)) && (
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

                  if (!hasRowActions) {
                    return rowEl;
                  }

                  return (
                    <ContextMenu key={rowCtid ?? row.id}>
                      <ContextMenuTrigger asChild>{rowEl}</ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuLabel className="font-mono text-[11px]">
                          Zeile {rowIndex + 1 + page * pageSize}
                        </ContextMenuLabel>
                        <ContextMenuSeparator />
                        {onDuplicateRow && (
                          <ContextMenuItem onClick={() => onDuplicateRow(rowCtid!)}>
                            <CopyPlusIcon />
                            Zeile duplizieren
                          </ContextMenuItem>
                        )}
                        {onDeleteRow && (
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() => onDeleteRow(rowCtid!, row.original)}
                          >
                            <Trash2Icon />
                            Zeile löschen
                          </ContextMenuItem>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
            </tbody>
          </table>
          </DragDropProvider>
        </div>
      </div>
      {rows.length > 0 &&
        (() => {
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
                    ? "Pfeiltasten navigieren · Enter oder Doppelklick zum Bearbeiten"
                    : "Navigiere mit Pfeiltasten · Doppelklick zum Kopieren"}
                </span>
              )}
              {onPageChange && totalPages != null && totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <span className="mr-1">
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
          );
        })()}

      {inspectCell && (
        <Dialog open={true} onOpenChange={() => setInspectCell(null)}>
          <DialogContent className="max-w-2xl sm:max-w-2xl border border-border bg-popover shadow-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <DatabaseIcon className="size-4 text-primary" />
                Spalte:{" "}
                <span className="font-mono text-primary font-bold">{inspectCell.columnName}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 my-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Zellendetails</span>
                <button
                  type="button"
                  onClick={() => {
                    const stringVal =
                      typeof inspectCell.value === "object"
                        ? JSON.stringify(inspectCell.value, null, 2)
                        : String(inspectCell.value);
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
