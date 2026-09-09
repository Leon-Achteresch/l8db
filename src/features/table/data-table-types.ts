import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import type { DetailedColumnInfo, ForeignKeyInfo } from "@/lib/db";

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
  onDuplicateRowToEdit?: (ctid: string, values: Record<string, unknown>) => void;
  onDeleteRow?: (ctid: string, oldValues: Record<string, unknown>) => void;
  onRefresh?: () => void | Promise<void>;
  columnDetails?: DetailedColumnInfo[];
  revealColumn?: { name: string; nonce: number } | null;
};
