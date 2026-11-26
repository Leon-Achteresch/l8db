import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import { createChangedOnlyJsonStorage } from "@/lib/buffered-storage";
import type { CsvColumnMapping, CsvEmptyFieldMode, ImportTargetColumn } from "@/lib/csv-import";
import type { CsvImportOutcome, ImportFormat, ImportPreview } from "@/lib/db";

export interface SqlImportDraft {
  fileName: string | null;
  filePath: string | null;
  sql: string | null;
  mode: ScriptRunMode;
  stopOnError: boolean;
  jobId: string | null;
  entries: ScriptRunEntry[] | null;
  error?: string | null;
  activeRun?: { id: symbol; fileName: string; jobId: string | null; attached: boolean };
}

export interface CsvImportDraft {
  format: ImportFormat;
  sheet: string | null;
  skipRows: number;
  structured: ImportPreview | null;
  partial?: boolean;
  conflict?: import("@/lib/db").CsvImportConflict;
  fileName: string | null;
  filePath: string | null;
  text: string | null;
  delimiter: string | null;
  quote: string;
  hasHeader: boolean | null;
  emptyField: CsvEmptyFieldMode;
  nullText?: string;
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
  format: "csv",
  sheet: null,
  skipRows: 0,
  structured: null,
  fileName: null,
  filePath: null,
  text: null,
  delimiter: null,
  quote: '"',
  hasHeader: null,
  emptyField: "null",
  nullText: "",
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
      storage: createChangedOnlyJsonStorage(),
      partialize: (state) => ({
        sql: Object.fromEntries(
          Object.entries(state.sql).map(([key, draft]) => [
            key,
            { ...draft, sql: null, entries: null, activeRun: undefined, error: undefined },
          ]),
        ),
        csv: Object.fromEntries(
          Object.entries(state.csv).map(([key, draft]) => [
            key,
            { ...draft, text: null, structured: null, outcome: null },
          ]),
        ),
      }),
    },
  ),
);

export function selectSqlImportFile(
  key: string,
  file: { path: string; name: string; text: string },
) {
  const { sql, patchSql } = useImportWorkspace.getState();
  const run = sql[key]?.activeRun;
  patchSql(key, {
    fileName: file.name,
    filePath: file.path,
    sql: file.text,
    jobId: null,
    entries: null,
    error: null,
    activeRun: run && { ...run, attached: false },
  });
}

export function beginSqlImport(key: string) {
  const { sql, patchSql } = useImportWorkspace.getState();
  const draft = sql[key];
  if (!draft?.sql || draft.activeRun) return null;
  const id = Symbol();
  patchSql(key, {
    activeRun: { id, fileName: draft.fileName ?? "SQL-Skript", jobId: null, attached: true },
    entries: null,
    error: null,
    jobId: null,
  });
  const current = () => {
    const run = useImportWorkspace.getState().sql[key]?.activeRun;
    return run?.id === id ? run : undefined;
  };
  return {
    onJob(jobId: string) {
      const run = current();
      if (run) patchSql(key, { activeRun: { ...run, jobId }, ...(run.attached && { jobId }) });
    },
    onProgress(entries: ScriptRunEntry[]) {
      if (current()?.attached) patchSql(key, { entries });
    },
    finish(error: string | null) {
      const run = current();
      if (run) patchSql(key, { activeRun: undefined, ...(run.attached && { error }) });
      return run?.attached === true;
    },
  };
}
