import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  type ColumnDef,
  type ColumnPinningState,
  flexRender,
  getCoreRowModel,
  type HeaderContext,
  type Row,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  CopyPlusIcon,
  ExternalLinkIcon,
  FingerprintIcon,
  HashIcon,
  KeyIcon,
  LinkIcon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RegexSearchHelper } from "@/components/regex-search-helper";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { CellValueDialog } from "@/features/table/cell-value-dialog";
import { DataTableAutoRefresh } from "@/features/table/data-table-auto-refresh";
import { DataTableColumnSettings } from "@/features/table/data-table-column-settings";
import { DataTableHeaderCell } from "@/features/table/data-table-header-cell";
import { DataTableHeaderName } from "@/features/table/data-table-header-name";
import { FkValuePickerDialog } from "@/features/table/fk-value-picker-dialog";
import {
  type AutoRefreshConditions,
  autoRefreshPauseReason,
  shouldAutoRefresh,
} from "@/lib/auto-refresh";
import { buildRowUpdates } from "@/lib/cell-editor";
import { useActiveConnection } from "@/lib/connections";
import { type DetailedColumnInfo, type ForeignKeyInfo, fetchTableRows } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { isNullableColumn, outgoingForeignKey, resolveFkTarget } from "@/lib/fk-lookup";
import { describeGridSearch, gridMatchKey, runGridSearch, stepMatchIndex } from "@/lib/grid-search";
import {
  describeSelectionStats,
  type GridCellRef,
  selectionCellCount,
  selectionRange,
  selectionToTsv,
  summarizeSelection,
} from "@/lib/grid-selection";
import { useColumnWindow } from "@/lib/hooks/use-column-window";
import { useResolvedHotkey } from "@/lib/hotkeys";
import { describeRegexError, insertRegexPattern } from "@/lib/regex-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import { compileSingleCondition } from "@/lib/sql-filter";
import { effectiveConnectionString } from "@/lib/ssh";
import {
  formatVisibleColumnNames,
  reorderVisibleColumns,
  toggleHiddenColumn,
  togglePinnedColumn,
  useTableColumnLayout,
} from "@/lib/table-column-prefs";
import { useTransactionStore } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import { DataTableRow } from "./data-table-row";
import type {
  DataTableProps,
  EditingCell,
  FkPickerCell,
  InspectCell,
  TableRow,
} from "./data-table-types";

const headerSensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: () => false,
  }),
];

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

type ColumnTypeKind = "text" | "number" | "boolean" | "date" | "json" | "key" | "uuid";

function kindFromDataType(dataType: string): ColumnTypeKind | null {
  const lower = dataType.toLowerCase();
  if (lower.includes("bool")) return "boolean";
  if (lower.includes("uuid") || lower === "uniqueidentifier") return "uuid";
  if (lower.includes("json") || lower === "object" || lower === "array") return "json";
  if (lower.includes("time") || lower.includes("date") || lower.includes("interval")) return "date";
  if (/^(number|numeric|dec|float|double|real|serial|money|binary_)|int/.test(lower))
    return "number";
  if (/char|text|clob|string/.test(lower)) return "text";
  return null;
}

function getColumnTypeInfo(col: string, rows: TableRow[], detail?: DetailedColumnInfo) {
  let first: unknown;
  for (const row of rows) {
    const value = row[col];
    if (value !== null && value !== undefined) {
      first = value;
      break;
    }
  }

  let type: ColumnTypeKind = "text";
  const known = detail ? kindFromDataType(detail.data_type) : null;

  if (detail?.is_primary_key) {
    type = "key";
  } else if (known) {
    type = known;
  } else if (col.toLowerCase() === "id" || col.toLowerCase() === "uuid") {
    type = col.toLowerCase() === "id" ? "key" : "uuid";
  } else if (first === undefined) {
    if (col.toLowerCase().endsWith("_id") || col.toLowerCase().endsWith("id")) {
      type = "key";
    } else {
      type = "text";
    }
  } else {
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
  onDuplicateRowToEdit,
  onDeleteRow,
  onRefresh,
  columnDetails,
}: DataTableProps) {
  const connection = useActiveConnection();
  const capabilities = useActiveCapabilities();
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
    saveProfile,
    applyProfile,
    renameProfile,
    deleteProfile,
  } = useTableColumnLayout(connection?.id, currentSchema, currentTable, columnNames);
  const [activeCell, setActiveCell] = useState<GridCellRef | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<GridCellRef | null>(null);
  const [inspectCell, setInspectCell] = useState<InspectCell | null>(null);
  const [fkPickerCell, setFkPickerCell] = useState<FkPickerCell | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [autoRefreshMs, setAutoRefreshMs] = useState(0);
  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [filterOperator, setFilterOperator] = useState("eq");
  const [filterValue, setFilterValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRegex = useRegexEnabled("grid");
  const setSearchRegex = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const [matchIndex, setMatchIndex] = useState(0);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const outgoingFkByColumn = useMemo(() => {
    const map = new Map<string, ForeignKeyInfo>();
    if (!foreignKeys || !currentSchema || !currentTable) return map;
    for (const fk of foreignKeys) {
      if (fk.from_schema === currentSchema && fk.from_table === currentTable) {
        map.set(fk.from_column, fk);
      }
    }
    return map;
  }, [foreignKeys, currentSchema, currentTable]);

  const canPickFk = !!onSaveRow && capabilities.foreign_keys && !!currentSchema && !!currentTable;

  const typeInfoByColumn = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getColumnTypeInfo>>();
    const detailByName = new Map((columnDetails ?? []).map((c) => [c.name, c]));
    for (const column of columnNames) {
      map.set(column, getColumnTypeInfo(column, data, detailByName.get(column)));
    }
    return map;
  }, [columnNames, data, columnDetails]);
  const headerStateRef = useRef({ typeInfoByColumn, isFetching, page, pageSize });
  headerStateRef.current = { typeInfoByColumn, isFetching, page, pageSize };

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
            {info.row.index + 1 + headerStateRef.current.page * headerStateRef.current.pageSize}
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
            const typeInfo =
              headerStateRef.current.typeInfoByColumn.get(column) ?? getColumnTypeInfo(column, []);
            const sorted = col.getIsSorted();
            const fk = fkByColumn.get(column);
            return (
              <div className="flex items-center gap-2 w-full min-w-0 justify-start">
                <button
                  type="button"
                  onClick={col.getToggleSortingHandler()}
                  disabled={headerStateRef.current.isFetching}
                  className="group flex items-center gap-1 rounded-sm px-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer min-w-0 shrink"
                >
                  <DataTableHeaderName name={column} />
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
    [columnNames, fkByColumn, onNavigateToTable, currentSchema, currentTable],
  );

  const columnOrder = useMemo(() => [INDEX_COLUMN, ...order], [order]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(hidden.map((column) => [column, false])),
    [hidden],
  );
  const searchColumns = useMemo(() => {
    const hiddenSet = new Set(hidden);
    return order.filter((column) => !hiddenSet.has(column));
  }, [order, hidden]);
  const columnPinning = useMemo<ColumnPinningState>(() => {
    const hiddenSet = new Set(hidden);
    return {
      left: [INDEX_COLUMN, ...pinned.filter((column) => !hiddenSet.has(column))],
      right: [],
    };
  }, [pinned, hidden]);
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchResult = useMemo(
    () =>
      searchOpen
        ? runGridSearch(data, searchColumns, deferredSearchQuery, { regex: searchRegex })
        : { matches: [], error: null },
    [searchOpen, data, searchColumns, deferredSearchQuery, searchRegex],
  );
  const matches = searchResult.matches;
  const searchError = searchResult.error;
  const matchKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const match of matches) keys.add(gridMatchKey(match.rowIndex, match.columnId));
    return keys;
  }, [matches]);
  const activeMatch = matches[matchIndex] ?? null;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnOrder, columnVisibility, columnPinning },
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
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom = rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0);
  const hasRowActions = !!onDuplicateRow || !!onDuplicateRowToEdit || !!onDeleteRow;
  const [menuRow, setMenuRow] = useState<{
    ctid: string;
    rowIndex: number;
    original: TableRow;
  } | null>(null);
  const colSpan = table.getVisibleLeafColumns().length || 1;
  const activeSort = sorting[0];
  const leftColumns = table.getLeftVisibleLeafColumns();
  const centerColumns = table.getCenterVisibleLeafColumns();
  const rightColumns = table.getRightVisibleLeafColumns();
  const visibleColumns = useMemo(
    () => [...leftColumns, ...centerColumns, ...rightColumns],
    [leftColumns, centerColumns, rightColumns],
  );
  const visibleDataColumns = useMemo(
    () => visibleColumns.map((column) => column.id).filter((id) => id !== INDEX_COLUMN),
    [visibleColumns],
  );
  const visibleColumnIds = visibleDataColumns;
  const columnSizing = table.getState().columnSizing;
  const columnWidths = useMemo(
    () => visibleColumns.map((column) => column.getSize()),
    [visibleColumns, columnSizing],
  );
  const pinnedIndices = useMemo(
    () => visibleColumns.flatMap((column, index) => (column.getIsPinned() ? [index] : [])),
    [visibleColumns, columnPinning],
  );
  const columnWindow = useColumnWindow(scrollRef, columnWidths, pinnedIndices);

  const selection = useMemo(
    () =>
      activeCell &&
      selectionAnchor &&
      activeCell.columnId !== INDEX_COLUMN &&
      selectionAnchor.columnId !== INDEX_COLUMN
        ? { anchor: selectionAnchor, focus: activeCell }
        : null,
    [activeCell, selectionAnchor],
  );
  const selectedRange = useMemo(
    () => selectionRange(selection, visibleColumnIds),
    [selection, visibleColumnIds],
  );
  const selectedCount = selectionCellCount(selectedRange);
  const selectionStats = useMemo(
    () => (selectedCount > 1 ? summarizeSelection(data, selectedRange) : null),
    [selectedCount, data, selectedRange],
  );

  const focusCell = useCallback((cell: GridCellRef | null, extend = false) => {
    setActiveCell(cell);
    if (!extend) setSelectionAnchor(cell);
  }, []);

  const copySelection = useCallback(() => {
    if (!selectedRange || selectedCount <= 1) return false;
    const tsv = selectionToTsv(data, selectedRange);
    if (tsv === "") return false;
    void navigator.clipboard.writeText(tsv);
    toast.success(`${selectedCount} Zellen als TSV kopiert.`);
    return true;
  }, [selectedRange, selectedCount, data]);

  const saveCellValue = useCallback(
    async (
      ctid: string,
      columnId: string,
      originalValues: Record<string, unknown>,
      next: string | null,
    ) => {
      if (!onSaveRow) return false;
      setIsSaving(true);
      try {
        const updates = buildRowUpdates(columnNames, originalValues, columnId, next);
        await onSaveRow(ctid, updates, originalValues);
        toast.success("Zeile gespeichert.");
        return true;
      } catch (err) {
        toast.error(typeof err === "string" ? err : String(err));
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onSaveRow, columnNames],
  );

  const handleSaveCell = useCallback(async () => {
    if (!editingCell || !onSaveRow || isSaving) return;
    const ok = await saveCellValue(
      editingCell.ctid,
      editingCell.columnId,
      editingCell.originalValues,
      editingCell.value === "" ? null : editingCell.value,
    );
    if (ok) setEditingCell(null);
  }, [editingCell, onSaveRow, isSaving, saveCellValue]);

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
    if (!activeCell) return;
    rowVirtualizer.scrollToIndex(activeCell.rowIndex, { align: "auto" });
    const columnIndex = visibleColumns.findIndex((column) => column.id === activeCell.columnId);
    if (columnWindow.enabled && columnIndex >= 0 && !pinnedIndices.includes(columnIndex)) {
      columnWindow.virtualizer.scrollToIndex(columnIndex, { align: "auto" });
    }
  }, [
    activeCell,
    rowVirtualizer,
    columnWindow.enabled,
    columnWindow.virtualizer,
    visibleColumns,
    pinnedIndices,
  ]);

  useEffect(() => {
    if (!editingCell || !tbodyRef.current) return;
    rowVirtualizer.scrollToIndex(editingCell.rowIndex, { align: "auto" });
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

  const columnTypeByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columnDetails ?? []) map.set(col.name, col.data_type);
    return map;
  }, [columnDetails]);

  const hasOpenTransaction = useTransactionStore((state) =>
    connection ? state.transactions.some((tx) => tx.connectionId === connection.id) : false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsWindowVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const autoRefreshConditions = useMemo<AutoRefreshConditions>(
    () => ({
      intervalMs: autoRefreshMs,
      isTabVisible: true,
      isWindowVisible,
      isEditing: editingCell !== null || inspectCell !== null || fkPickerCell !== null,
      isSaving,
      isFetching,
      hasOpenTransaction,
    }),
    [
      autoRefreshMs,
      isWindowVisible,
      editingCell,
      inspectCell,
      fkPickerCell,
      isSaving,
      isFetching,
      hasOpenTransaction,
    ],
  );

  const autoRefreshRef = useRef(autoRefreshConditions);
  autoRefreshRef.current = autoRefreshConditions;
  const autoRefreshPause = autoRefreshPauseReason(autoRefreshConditions);

  useEffect(() => {
    if (!onRefresh || autoRefreshMs <= 0) return;
    const id = setInterval(() => {
      if (!shouldAutoRefresh(autoRefreshRef.current)) return;
      void Promise.resolve(onRefresh()).catch((err) => {
        toast.error(typeof err === "string" ? err : String(err));
      });
    }, autoRefreshMs);
    return () => clearInterval(id);
  }, [onRefresh, autoRefreshMs]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setMatchIndex(0);
  }, []);

  const stepMatch = useCallback(
    (step: number) => {
      setMatchIndex((current) => stepMatchIndex(current, matches.length, step));
    },
    [matches.length],
  );

  const copyColumnNames = useCallback(() => {
    const names = formatVisibleColumnNames(order, hidden);
    if (names === "") return;
    void navigator.clipboard.writeText(names);
    toast.success("Spaltennamen kopiert.");
  }, [order, hidden]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Treffer neu zählen bei Query- oder Datenwechsel
  useEffect(() => {
    setMatchIndex(0);
  }, [searchQuery, data]);

  useEffect(() => {
    if (!activeMatch) return;
    const matchCell = { rowIndex: activeMatch.rowIndex, columnId: activeMatch.columnId };
    setActiveCell(matchCell);
    setSelectionAnchor(matchCell);
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const cell = Array.from(tbody.querySelectorAll<HTMLTableCellElement>("td[data-col]")).find(
      (element) =>
        element.dataset.rowIndex === String(activeMatch.rowIndex) &&
        element.dataset.col === activeMatch.columnId,
    );
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeMatch]);

  const gridSearchHotkey = useResolvedHotkey("grid.search");
  const gridCopyHotkey = useResolvedHotkey("grid.copy");
  const gridNextPageHotkey = useResolvedHotkey("grid.nextPage");
  const gridPrevPageHotkey = useResolvedHotkey("grid.prevPage");

  useHotkey(
    gridSearchHotkey,
    (event) => {
      const root = rootRef.current;
      const focusInside = root?.contains(document.activeElement) ?? false;
      if (!focusInside && activeCell === null) return;
      event.preventDefault();
      setSearchOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.select());
    },
    { ignoreInputs: false },
  );

  const copyActiveCell = useCallback(() => {
    if (!activeCell) return;
    const { rowIndex, columnId } = activeCell;
    if (copySelection()) return;
    if (columnId === INDEX_COLUMN) return;
    const row = rows[rowIndex];
    const val = row?.getValue(columnId);
    if (val !== undefined) {
      const stringVal = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      void navigator.clipboard.writeText(stringVal);
      toast.success("Wert in die Zwischenablage kopiert!");
    }
  }, [activeCell, copySelection, rows]);

  useHotkey(
    gridCopyHotkey,
    (event) => {
      const root = rootRef.current;
      const focusInside = root?.contains(document.activeElement) ?? false;
      if (!focusInside && activeCell === null) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (editingCell) return;
      event.preventDefault();
      copyActiveCell();
    },
    { ignoreInputs: false },
  );

  useHotkey(
    gridNextPageHotkey,
    (event) => {
      if (!onPageChange || totalCount == null) return;
      const root = rootRef.current;
      if (!(root?.contains(document.activeElement) ?? false)) return;
      const totalPages = Math.ceil(totalCount / pageSize);
      if (page >= totalPages - 1) return;
      event.preventDefault();
      onPageChange(page + 1);
    },
    { ignoreInputs: false },
  );

  useHotkey(
    gridPrevPageHotkey,
    (event) => {
      if (!onPageChange) return;
      const root = rootRef.current;
      if (!(root?.contains(document.activeElement) ?? false)) return;
      if (page <= 0) return;
      event.preventDefault();
      onPageChange(page - 1);
    },
    { ignoreInputs: false },
  );

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

      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (!activeCell) return;
      const { rowIndex, columnId } = activeCell;
      const colIndex = visibleDataColumns.indexOf(columnId);

      if (e.key === "Escape") {
        if (selectedCount > 1) {
          setSelectionAnchor(activeCell);
          return;
        }
        setActiveCell(null);
        setSelectionAnchor(null);
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
        nextColIndex = Math.max(e.shiftKey ? 0 : -1, colIndex - 1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        nextColIndex = Math.min(visibleDataColumns.length - 1, colIndex + 1);
        e.preventDefault();
      }

      const nextColumnId = nextColIndex === -1 ? INDEX_COLUMN : visibleDataColumns[nextColIndex];
      if (nextRowIndex !== rowIndex || nextColumnId !== columnId) {
        focusCell({ rowIndex: nextRowIndex, columnId: nextColumnId }, e.shiftKey);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeCell,
    visibleDataColumns,
    rows,
    editingCell,
    handleSaveCell,
    onSaveRow,
    handleCellEdit,
    focusCell,
    copySelection,
    selectedCount,
  ]);

  const handleCellCopy = useCallback((val: unknown) => {
    if (val === undefined || val === null) return;
    const stringVal = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
    void navigator.clipboard.writeText(stringVal);
    toast.success("In die Zwischenablage kopiert!");
  }, []);

  const headerGroups = table.getHeaderGroups();
  const resizingColumn = table.getState().columnSizingInfo.isResizingColumn;
  const tableHeader = useMemo(
    () => (
      <thead className="sticky top-0 z-10 select-none">
        {headerGroups.map((headerGroup) => (
          <tr key={headerGroup.id}>
            {columnWindow.items.map((item) => {
              if (item.spacer)
                return (
                  <th
                    key={`gap-${item.index}`}
                    aria-hidden
                    colSpan={item.span}
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
                        className="w-12 sticky left-0 z-30 border-b border-r border-border bg-muted px-3 py-2 text-center align-middle"
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
                        onToggle={(column) => setHidden(toggleHiddenColumn(order, hidden, column))}
                        onReorder={setOrder}
                        onReset={reset}
                        onShowAll={() => setHidden([])}
                        onUnpinAll={() => setPinned([])}
                        onCopyColumnNames={copyColumnNames}
                        profiles={profiles}
                        canUseProfiles={canUseProfiles}
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
                  onApplyFilter={onApplyFilter}
                  onApplyColumnFilter={applyColumnFilter}
                  onHideColumn={() => setHidden(toggleHiddenColumn(order, hidden, header.id))}
                  canHide={visibleDataColumns.length > 1}
                  isPinned={pinnedSet.has(header.id)}
                  onTogglePin={() => setPinned(togglePinnedColumn(order, pinned, header.id))}
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
      profiles,
      canUseProfiles,
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
      applyColumnFilter,
      pinnedSet,
    ],
  );

  return (
    <div ref={rootRef} className={cn("flex min-h-0 flex-1 flex-col relative", className)}>
      {isFetching && (
        <div className="absolute top-0 left-0 right-0 z-50 h-0.5 w-full bg-primary/20 overflow-hidden">
          <div className="h-full w-1/3 bg-primary animate-pulse rounded-full" />
        </div>
      )}
      {searchOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            // biome-ignore lint/a11y/noAutofocus: Suchfeld wird gezielt geöffnet
            autoFocus
            placeholder={searchRegex ? "Regex in geladenen Zeilen…" : "In geladenen Zeilen suchen…"}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                stepMatch(event.shiftKey ? -1 : 1);
              }
            }}
            className="h-6 min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/60"
          />
          <span
            className={cn(
              "shrink-0 font-mono text-[11px] tabular-nums",
              searchError ? "text-destructive" : "text-muted-foreground",
            )}
            title={searchError ? describeRegexError(searchError) : undefined}
          >
            {searchError
              ? describeRegexError(searchError)
              : describeGridSearch(matches.length, matchIndex)}
          </span>
          <RegexSearchHelper
            enabled={searchRegex}
            onEnabledChange={(enabled) => setSearchRegex("grid", enabled)}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onInsert={(snippet) => {
              const input = searchInputRef.current;
              const start = input?.selectionStart ?? searchQuery.length;
              const end = input?.selectionEnd ?? searchQuery.length;
              const next = insertRegexPattern(searchQuery, start, end, snippet);
              setSearchQuery(next.value);
              requestAnimationFrame(() => {
                input?.focus();
                input?.setSelectionRange(next.cursor, next.cursor);
              });
            }}
            error={searchError}
            matchCount={matches.length}
          />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {data.length} geladene {data.length === 1 ? "Zeile" : "Zeilen"} · {searchColumns.length}{" "}
            sichtbare Spalten
          </span>
          <button
            type="button"
            title="Vorheriger Treffer"
            disabled={matches.length === 0}
            onClick={() => stepMatch(-1)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <ArrowUpIcon className="size-3.5" />
          </button>
          <button
            type="button"
            title="Nächster Treffer"
            disabled={matches.length === 0}
            onClick={() => stepMatch(1)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <ArrowDownIcon className="size-3.5" />
          </button>
          <button
            type="button"
            title="Suche schließen"
            onClick={closeSearch}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent cursor-pointer"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
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
              <colgroup>
                {visibleColumns.map((column, index) => (
                  <col key={column.id} style={{ width: columnWidths[index] }} />
                ))}
              </colgroup>
              {tableHeader}
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <tbody
                    ref={tbodyRef}
                    onContextMenuCapture={(event) => {
                      const tr = (event.target as HTMLElement).closest<HTMLTableRowElement>(
                        "tr[data-ctid]",
                      );
                      const ctid = tr?.dataset.ctid;
                      const row = ctid ? rows[Number(tr?.dataset.rowIndex)] : undefined;
                      if (!ctid || !row || !hasRowActions) {
                        event.stopPropagation();
                        return;
                      }
                      setMenuRow({ ctid, rowIndex: row.index, original: row.original });
                    }}
                  >
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
                      <>
                        {paddingTop > 0 && (
                          <tr aria-hidden style={{ height: paddingTop }}>
                            <td colSpan={colSpan} className="p-0" />
                          </tr>
                        )}
                        {virtualRows.map((virtualRow) => {
                          const row = rows[virtualRow.index];
                          const rowIndex = row.index;
                          const rowCtid = row.original.__ctid__ as string | undefined;
                          return (
                            <DataTableRow
                              key={rowCtid ?? row.id}
                              row={row}
                              columnWindow={columnWindow.items}
                              measureElement={rowVirtualizer.measureElement}
                              editingCell={editingCell?.rowIndex === rowIndex ? editingCell : null}
                              activeCell={activeCell?.rowIndex === rowIndex ? activeCell : null}
                              activeMatch={activeMatch?.rowIndex === rowIndex ? activeMatch : null}
                              selectedRange={selectedRange}
                              selectedCount={selectedCount}
                              matchKeys={matchKeys}
                              isSaving={isSaving}
                              canPickFk={canPickFk}
                              outgoingFkByColumn={outgoingFkByColumn}
                              onSaveRow={onSaveRow}
                              focusCell={focusCell}
                              handleCellEdit={handleCellEdit}
                              handleCellCopy={handleCellCopy}
                              setEditingCell={setEditingCell}
                              setInspectCell={setInspectCell}
                              setFkPickerCell={setFkPickerCell}
                              columnSizing={table.getState().columnSizing}
                              columnOrder={columnOrder}
                              columnVisibility={columnVisibility}
                              columnPinning={columnPinning}
                              columns={columns}
                              pageOffset={page * pageSize}
                            />
                          );
                        })}
                        {paddingBottom > 0 && (
                          <tr aria-hidden style={{ height: paddingBottom }}>
                            <td colSpan={colSpan} className="p-0" />
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </ContextMenuTrigger>
                {menuRow && (
                  <ContextMenuContent>
                    <ContextMenuLabel className="font-mono text-[11px]">
                      Zeile {menuRow.rowIndex + 1 + page * pageSize}
                    </ContextMenuLabel>
                    <ContextMenuSeparator />
                    {onDuplicateRow && (
                      <ContextMenuItem onClick={() => onDuplicateRow(menuRow.ctid)}>
                        <CopyPlusIcon />
                        Zeile duplizieren
                      </ContextMenuItem>
                    )}
                    {onDuplicateRowToEdit && (
                      <ContextMenuItem
                        onClick={() => onDuplicateRowToEdit(menuRow.ctid, menuRow.original)}
                      >
                        <CopyPlusIcon />
                        Als neue Zeile duplizieren
                      </ContextMenuItem>
                    )}
                    {onDeleteRow && (
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => onDeleteRow(menuRow.ctid, menuRow.original)}
                      >
                        <Trash2Icon />
                        Zeile löschen
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                )}
              </ContextMenu>
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
            <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground select-none">
              <span className="whitespace-nowrap">
                {totalCount != null
                  ? `${rangeStart}–${rangeEnd} von ${totalCount}`
                  : `${rows.length} ${rows.length === 1 ? "Zeile" : "Zeilen"}`}
              </span>
              <div className="min-w-0 truncate text-center">
                {selectionStats ? (
                  <span className="truncate font-mono">
                    {describeSelectionStats(selectionStats)}
                  </span>
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
                    {onSaveRow
                      ? "Pfeiltasten navigieren · Enter oder Doppelklick zum Bearbeiten"
                      : "Navigiere mit Pfeiltasten · Doppelklick zum Kopieren"}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-end gap-4">
                {onRefresh && (
                  <DataTableAutoRefresh
                    intervalMs={autoRefreshMs}
                    pauseReason={autoRefreshPause}
                    onIntervalChange={setAutoRefreshMs}
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
        })()}

      {inspectCell && (
        <CellValueDialog
          columnName={inspectCell.columnName}
          value={inspectCell.value}
          dataType={columnTypeByName.get(inspectCell.columnName) ?? null}
          canEdit={!!onSaveRow && !!inspectCell.ctid && !!inspectCell.originalValues}
          isSaving={isSaving}
          onClose={() => setInspectCell(null)}
          onSave={async (next) => {
            if (!inspectCell.ctid || !inspectCell.originalValues) return;
            const ok = await saveCellValue(
              inspectCell.ctid,
              inspectCell.columnName,
              inspectCell.originalValues,
              next,
            );
            if (ok) setInspectCell(null);
          }}
        />
      )}

      {fkPickerCell &&
        (() => {
          const fk = outgoingForeignKey(
            foreignKeys,
            currentSchema ?? "",
            currentTable ?? "",
            fkPickerCell.columnName,
          );
          const target = fk ? resolveFkTarget(fk, currentSchema ?? "", currentTable ?? "") : null;
          if (!target) return null;
          return (
            <FkValuePickerDialog
              columnName={fkPickerCell.columnName}
              target={target}
              currentValue={fkPickerCell.currentValue}
              allowNull={isNullableColumn(columnDetails, fkPickerCell.columnName)}
              isSaving={isSaving}
              onClose={() => setFkPickerCell(null)}
              onSelect={async (next) => {
                const ok = await saveCellValue(
                  fkPickerCell.ctid,
                  fkPickerCell.columnName,
                  fkPickerCell.originalValues,
                  next,
                );
                if (ok) setFkPickerCell(null);
              }}
            />
          );
        })()}
    </div>
  );
}
