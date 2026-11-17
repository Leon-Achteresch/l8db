import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createCsvFileCheck } from "@/lib/csv-file-check";
import type { CsvCheckRequest } from "@/lib/db";

export function useCsvFileCheck(request: CsvCheckRequest | null, scope: string) {
  const check = useMemo(() => createCsvFileCheck(scope ? request : null), [request, scope]);
  useEffect(() => () => check.invalidate(), [check]);
  const state = useSyncExternalStore(check.subscribe, check.getSnapshot, check.getSnapshot);
  return {
    ...state,
    canCheck: request !== null && Boolean(scope),
    run: check.run,
    cancel: check.cancel,
    invalidate: check.invalidate,
  };
}
