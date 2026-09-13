import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import type { CsvColumnMapping, CsvEmptyFieldMode, ImportTargetColumn } from "@/lib/csv-import";
import type { CsvImportOutcome } from "@/lib/db";

export interface SqlImportDraft {
  fileName: string | null;
  filePath: string | null;
  sql: string | null;
  mode: ScriptRunMode;
  stopOnError: boolean;
  jobId: string | null;
  entries: ScriptRunEntry[] | null;
}

export interface CsvImportDraft {
  fileName: string | null;
  filePath: string | null;
  text: string | null;
  delimiter: string | null;
  quote: string;
  hasHeader: boolean | null;
  emptyField: CsvEmptyFieldMode;
  targetTable: string | null;
  targetColumns: ImportTargetColumn[];
  mappings: CsvColumnMapping[];
  outcome: CsvImportOutcome | null;
  jobId: string | null;
}

export const EMPTY_SQL_IMPORT: SqlImportDraft = {
  fileName: null,
  filePath: null,
  sql: null,
  mode: "new-transaction",
  stopOnError: true,
  jobId: null,
  entries: null,
};
export const EMPTY_CSV_IMPORT: CsvImportDraft = {
  fileName: null,
  filePath: null,
  text: null,
  delimiter: null,
  quote: '"',
  hasHeader: null,
  emptyField: "null",
  targetTable: null,
  targetColumns: [],
  mappings: [],
  outcome: null,
  jobId: null,
};

interface ImportWorkspace {
  sql: Record<string, SqlImportDraft>;
  csv: Record<string, CsvImportDraft>;
  patchSql: (key: string, patch: Partial<SqlImportDraft>) => void;
  patchCsv: (key: string, patch: Partial<CsvImportDraft>) => void;
}

export const useImportWorkspace = create<ImportWorkspace>()(
  persist(
    (set) => ({
      sql: {},
      csv: {},
      patchSql: (key, patch) =>
        set((state) => ({
          sql: { ...state.sql, [key]: { ...EMPTY_SQL_IMPORT, ...state.sql[key], ...patch } },
        })),
      patchCsv: (key, patch) =>
        set((state) => ({
          csv: { ...state.csv, [key]: { ...EMPTY_CSV_IMPORT, ...state.csv[key], ...patch } },
        })),
    }),
    {
      name: "l8db.import-workspace",
      partialize: (state) => ({
        sql: Object.fromEntries(
          Object.entries(state.sql).map(([key, draft]) => [
            key,
            { ...draft, sql: null, entries: null },
          ]),
        ),
        csv: Object.fromEntries(
          Object.entries(state.csv).map(([key, draft]) => [
            key,
            { ...draft, text: null, outcome: null },
          ]),
        ),
      }),
    },
  ),
);
