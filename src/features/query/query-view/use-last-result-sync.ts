import { useEffect } from "react";
import { maskQueryResult } from "@/features/query/query-result-masking";
import { clearLastResult, setLastResult } from "@/lib/ai/last-result";
import type { QueryResult } from "@/lib/db";
import { useActiveMasks } from "@/lib/masking-display";

const NO_COLUMNS: string[] = [];

export function useLastResultSync(
  tabId: string,
  connectionId: string | null,
  sql: string,
  result: QueryResult | null,
) {
  const { active } = useActiveMasks(result?.columns ?? NO_COLUMNS);
  useEffect(() => {
    const masked = maskQueryResult(result, active);
    if (masked?.columns.length) setLastResult({ owner: tabId, connectionId, sql, result: masked });
    else clearLastResult(tabId);
  }, [tabId, connectionId, sql, result, active]);
  useEffect(() => () => clearLastResult(tabId), [tabId]);
}
