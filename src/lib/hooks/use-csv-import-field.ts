import { type Dispatch, type SetStateAction, useCallback } from "react";
import { type CsvImportDraft, EMPTY_CSV_IMPORT, useImportWorkspace } from "@/lib/import-workspace";

export function useCsvImportField<K extends keyof CsvImportDraft>(
  key: string,
  field: K,
): [CsvImportDraft[K], Dispatch<SetStateAction<CsvImportDraft[K]>>] {
  const value = useImportWorkspace((state) => (state.csv[key] ?? EMPTY_CSV_IMPORT)[field]);
  const update = useCallback<Dispatch<SetStateAction<CsvImportDraft[K]>>>(
    (next) => {
      const store = useImportWorkspace.getState();
      const current = (store.csv[key] ?? EMPTY_CSV_IMPORT)[field];
      store.patchCsv(key, { [field]: typeof next === "function" ? next(current) : next });
    },
    [key, field],
  );
  return [value, update];
}
