import { useMemo } from "react";
import type { QueryResult } from "@/lib/db";
import { applyMasks, type ColumnMask } from "@/lib/masking";
import { useActiveMasks } from "@/lib/masking-display";

export function maskQueryResult(
  result: QueryResult | null,
  masks: ColumnMask[],
): QueryResult | null {
  if (!result || masks.length === 0) return result;
  return { ...result, rows: applyMasks(result.columns, result.rows, masks) };
}

export function resultJsonRows(
  result: QueryResult | null,
  masks: ColumnMask[],
): Record<string, unknown>[] {
  const source = maskQueryResult(result, masks);
  if (!source) return [];
  return source.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const column of source.columns) obj[column] = row[column] ?? null;
    return obj;
  });
}

export function useMaskedQueryResult(result: QueryResult | null) {
  const { active } = useActiveMasks(result?.columns ?? []);
  const masked = useMemo(() => maskQueryResult(result, active), [result, active]);
  return { masked, masks: active };
}
