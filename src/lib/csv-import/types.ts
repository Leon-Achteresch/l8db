export const CSV_MAX_BYTES = 10 * 1024 * 1024;

export const CSV_PREVIEW_ROWS = 100;

export const CSV_MAX_IMPORT_ROWS = 10_000;

export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;

export type CsvCell = string | null;

export type CsvEmptyFieldMode = "null" | "empty";

export interface CsvParseOptions {
  delimiter?: string;
  quote?: string;
  hasHeader?: boolean;
  maxRows?: number;
  emptyField?: CsvEmptyFieldMode;
}

export interface CsvParseResult {
  delimiter: string;
  quote: string;
  hasHeader: boolean;
  headers: string[];
  rows: CsvCell[][];
  columnCount: number;
  totalRows: number | null;
  truncated: boolean;
  raggedRows: number[];
}

export interface ImportTargetColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  has_default: boolean;
  is_identity: boolean;
  is_generated: boolean;
}

export interface CsvColumnMapping {
  csvIndex: number;
  target: string | null;
}

export interface CsvMappingIssues {
  errors: string[];
  warnings: string[];
}
