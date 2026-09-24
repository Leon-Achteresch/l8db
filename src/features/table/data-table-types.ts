import type { OnChangeFn, RowData, SortingState } from "@tanstack/react-table";
import type { DetailedColumnInfo, ForeignKeyInfo } from "@/lib/db";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    dataType?: string;
  }
}

export type TableRow = Record<string, unknown>;

export type EditingCell = {
  ctid: string;
  rowIndex: number;
  columnId: string;
  value: string;
  originalValues: Record<string, unknown>;
};

export type InspectCell = {
  columnName: string;
  value: unknown;
  ctid?: string;
  originalValues?: Record<string, unknown>;
};

export type FkPickerCell = {
  columnName: string;
  ctid: string;
  originalValues: Record<string, unknown>;
  currentValue: string | null;
};

export type DataTableProps = {
  stateKey?: string;
  layoutKey?: string;
  scrollIdentity?: string;
  columns: string[];
  data: TableRow[];
  emptyMessage: string;
  className?: string;
  sorting: SortingState;
  sortableColumns?: string[];
  onSortingChange: OnChangeFn<SortingState>;
  isFetching?: boolean;
  onSaveRow?: (
    ctid: string,
    updates: Record<string, string | null>,
    oldValues: Record<string, unknown>,
  ) => Promise<void>;
  canEditCell?: (row: TableRow, column: string) => boolean;
  filterableColumns?: string[];
  compileColumnFilter?: (column: string, operator: string, value: string) => string | null;
  filterOperators?: { key: string; label: string }[];
  filterPrefix?: string;
  emptyEditValue?: string;
  cellEditorKind?: "text" | "json";
  onApplyFilter?: (where: string, isRaw: boolean) => void;
  page?: number;
  totalCount?: number;
  countLabel?: string;
  onExactCount?: () => void;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  foreignKeys?: ForeignKeyInfo[];
  currentSchema?: string;
  currentTable?: string;
  onNavigateToTable?: (schema: string, table: string, filter?: string, inTab?: boolean) => void;
  onInsertRow?: (values: Record<string, string | null>) => Promise<void>;
  onDeleteRow?: (ctid: string, oldValues: Record<string, unknown>) => void;
  onRefresh?: () => void | Promise<void>;
  columnDetails?: DetailedColumnInfo[];
  revealColumn?: { name: string; nonce: number } | null;
  searchRequiresFocus?: boolean;
  addRowSignal?: number;
  autoSelectFirstCell?: boolean;
};
