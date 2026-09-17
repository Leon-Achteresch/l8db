import type { UseQueryResult } from "@tanstack/react-query";
import { queryErrorMessage } from "@/lib/connection-url";
import { toLabel } from "@/lib/dashboards";
import type { QueryResult } from "@/lib/db";

export function ChartPreviewTable({ query }: { query: UseQueryResult<QueryResult> }) {
  if (query.isError)
    return (
      <p role="alert" className="px-3 py-2 text-[11px] text-destructive">
        {queryErrorMessage(query.error)}
      </p>
    );
  const data = query.data;
  if (!data || data.rows.length === 0)
    return (
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {query.isFetching ? "Daten werden geladen…" : "Noch keine Daten zum Anzeigen."}
      </p>
    );
  return (
    <div className="max-h-44 overflow-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="sticky top-0 bg-muted text-left text-muted-foreground">
            {data.columns.map((c) => (
              <th key={c} className="px-2 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.slice(0, 8).map((row, i) => (
            <tr key={String(i)} className="border-t border-border/50">
              {data.columns.map((c) => (
                <td key={c} className="max-w-28 truncate px-2 py-1 tabular-nums">
                  {toLabel(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[10px] text-muted-foreground">
        {data.rows.length} Zeilen im Ergebnis
      </p>
    </div>
  );
}
