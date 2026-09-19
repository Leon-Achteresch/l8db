export const PREVIEW_ROWS = 5;

export const DEFAULT_MAX_ROWS = 1_000_000;

export const CONFIRM_ROWS = 100_000;

export type FullTableExportSource = {
  schema: string;
  table: string;
  filter: string;
  filterRaw: boolean;
  orderBy: string | null;
  orderDesc: boolean;
  isView: boolean;
  totalRows?: number | null;
};

export type CsvExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  rows: Record<string, unknown>[];
  defaultFileName: string;
  fullExport?: FullTableExportSource;
};
