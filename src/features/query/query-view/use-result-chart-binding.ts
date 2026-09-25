import { useMemo } from "react";
import type { ResultChartBinding } from "@/features/query/result-chart/types";
import { EMPTY_RESULT_CHART, useResultChartStore } from "@/lib/result-chart-store";
import { useTableTabs } from "@/lib/table-tabs";
import type { QueryViewCapabilities, QueryViewConnection } from "./types";

export function useResultChartBinding(
  tabId: string,
  sql: string,
  connection: QueryViewConnection,
  database: string | null,
  caps: QueryViewCapabilities,
): ResultChartBinding {
  const state = useResultChartStore((s) => s.charts[tabId]) ?? EMPTY_RESULT_CHART;
  const setChart = useResultChartStore((s) => s.set);
  const title = useTableTabs((s) => {
    const tab = s.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? tab.title : "Abfrage";
  });
  return useMemo(
    () => ({
      state,
      onChange: (next) => setChart(tabId, next),
      sql,
      name: title,
      connectionId: connection?.id ?? null,
      database,
      kind: connection?.kind ?? null,
      sqlCapable: caps.query_language === "sql",
    }),
    [
      state,
      setChart,
      tabId,
      sql,
      title,
      connection?.id,
      connection?.kind,
      database,
      caps.query_language,
    ],
  );
}
