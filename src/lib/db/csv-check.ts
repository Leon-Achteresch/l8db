import type { ImportFileSource } from "./columns";
import { invoke } from "./core";

export interface CsvCheckRequest {
  source: ImportFileSource;
  expected_columns: number;
  columns: { index: number; name: string; nullable: boolean }[];
}

export interface CsvCheckReport {
  status: "complete" | "cancelled" | "incomplete" | "changed";
  checked_rows: number;
  error_count: number;
  issues: {
    row: number;
    line: number;
    column: string | null;
    kind: "structure" | "not_null" | "parse";
    message: string;
  }[];
  source_size: number;
  source_modified_ms: number | null;
}

export function checkCsvFile(request: CsvCheckRequest, jobId: string): Promise<CsvCheckReport> {
  return invoke("check_csv_file", { request, options: { jobId } });
}
