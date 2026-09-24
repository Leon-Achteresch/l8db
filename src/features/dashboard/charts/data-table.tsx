import { useState } from "react";
import { toLabel } from "@/lib/dashboards";
import type { ChartProps } from "./chart-utils";

const PAGE = 40;

export function DataTable({ rows, shape }: ChartProps) {
  const [limit, setLimit] = useState(PAGE);
  const columns = [
    ...(shape.dimension ? [{ key: shape.dimension, label: "Aufteilung" }] : []),
    ...(shape.dimension2 ? [{ key: shape.dimension2, label: "Zweite Aufteilung" }] : []),
    ...shape.metrics,
  ];
  const keys = columns.length
    ? columns
    : Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k }));
  return (
    <div
      className="h-full overflow-auto rounded-xl border"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (limit < rows.length && el.scrollTop + el.clientHeight * 2 > el.scrollHeight)
          setLimit((current) => current + PAGE);
      }}
    >
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-muted-foreground">
            {keys.map((c) => (
              <th key={c.key} className="border-b px-2.5 py-1.5 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row, i) => (
            <tr key={String(i)} className="border-b border-border/50 last:border-0">
              {keys.map((c) => (
                <td key={c.key} className="max-w-48 truncate px-2.5 py-1.5 tabular-nums">
                  {toLabel(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
