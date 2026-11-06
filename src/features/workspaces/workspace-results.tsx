import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { QueryResult } from "@/lib/db";

export function WorkspaceResults({ result }: { result: QueryResult }) {
  const scroll = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 30,
    overscan: 5,
    initialRect: { width: 900, height: 300 },
  });
  const columns = useVirtualizer({
    count: result.columns.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 180,
    horizontal: true,
    overscan: 2,
    initialRect: { width: 900, height: 300 },
  });
  const text = (value: unknown) =>
    value == null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {result.rows.length} Zeilen · {result.execution_time_ms} ms
        {result.rows_affected !== null ? ` · ${result.rows_affected} geändert` : ""}
        {result.truncated ? " · Ergebnis begrenzt, SQL weiter eingrenzen" : ""}
      </p>
      <div
        ref={scroll}
        className="h-80 overflow-auto rounded-xl border"
        role="table"
        aria-label="Workspace SQL-Ergebnis"
        aria-rowcount={result.rows.length + 1}
        aria-colcount={result.columns.length}
      >
        <div
          className="relative"
          style={{ height: (result.rows.length + 1) * 30, width: columns.getTotalSize() }}
        >
          <div role="row" className="sticky top-0 z-10 h-[30px] bg-muted">
            {columns.getVirtualItems().map((column) => (
              <div
                key={column.key}
                role="columnheader"
                className="absolute top-0 h-[30px] truncate border-r px-2 py-1 text-xs font-medium"
                style={{ left: column.start, width: column.size }}
                title={result.columns[column.index]}
              >
                {result.columns[column.index]}
              </div>
            ))}
          </div>
          {rows.getVirtualItems().map((row) => (
            <div
              key={row.key}
              role="row"
              aria-rowindex={row.index + 2}
              className="absolute left-0 h-[30px] border-b"
              style={{ top: row.start + 30, width: columns.getTotalSize() }}
            >
              {columns.getVirtualItems().map((column) => {
                const value = text(result.rows[row.index][result.columns[column.index]]);
                return (
                  <div
                    key={column.key}
                    role="cell"
                    className="absolute top-0 h-[30px] truncate border-r px-2 py-1 font-mono text-xs"
                    style={{ left: column.start, width: column.size }}
                    title={value}
                  >
                    {value}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
