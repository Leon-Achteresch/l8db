import type { QueryResult } from "@/lib/db";
import { createObjectMessage } from "@/lib/sql-statements";

import { MAX_RESULT_ROWS } from "./constants";

export function withCreateNotice(res: QueryResult | null, sql: string): QueryResult | null {
  if (!res || res.columns.length > 0) return res;
  const notice = createObjectMessage(sql);
  return notice ? { ...res, notice } : res;
}

export function rowCountOf(res: QueryResult): number | null {
  return res.columns.length > 0
    ? res.rows.length
    : res.rows_affected != null
      ? Number(res.rows_affected)
      : null;
}

export function buildStatusText(result: QueryResult | null): string | null {
  if (!result) return null;
  const parts: string[] = [];
  if (result.notice) parts.push(result.notice);
  if (result.columns.length > 0) {
    parts.push(`${result.rows.length} Zeile${result.rows.length === 1 ? "" : "n"}`);
    // ponytail: Backend kappt bei 1000; exakte Flag-Übertragung erst, wenn QueryResult ein truncated-Feld bekommt
    if (result.rows.length === MAX_RESULT_ROWS) parts.push("auf 1000 begrenzt");
  }
  if (
    result.rows_affected !== null &&
    result.rows_affected !== undefined &&
    result.columns.length === 0
  ) {
    parts.push(`${result.rows_affected} betroffen`);
  }
  parts.push(`${result.execution_time_ms} ms`);
  return parts.join(" · ");
}

export function runLabelFor(runTarget: string, hasSelection: boolean): string {
  return runTarget === "all"
    ? "Alles ausführen"
    : hasSelection
      ? "Auswahl ausführen"
      : runTarget === "selection-or-statement"
        ? "Statement ausführen"
        : "Ausführen";
}
