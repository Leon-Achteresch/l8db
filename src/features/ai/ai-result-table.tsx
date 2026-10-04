import { useMemo } from "react";
import type { AiTable } from "@/lib/ai/result";
import { cn } from "@/lib/utils";

const NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export function AiResultTable({ table }: { table: AiTable }) {
  const numeric = useMemo(
    () =>
      new Set(
        table.columns.filter((column) =>
          table.rows.every((row) => row[column] === null || NUMBER.test(row[column] ?? "")),
        ),
      ),
    [table],
  );
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-collapse text-left text-xs tabular-nums">
        <thead className="sticky top-0 bg-card">
          <tr className="shadow-[inset_0_-1px_0_var(--border)]">
            {table.columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-[11px] font-medium text-muted-foreground",
                  numeric.has(column) && "text-right",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr
              key={String(index)}
              className="border-t border-border/50 transition-colors hover:bg-muted/40"
            >
              {table.columns.map((column) => (
                <td
                  key={column}
                  className={cn(
                    "max-w-64 truncate px-3 py-1.5",
                    numeric.has(column) && "text-right",
                  )}
                  title={row[column] ?? ""}
                >
                  {row[column] ?? <span className="text-muted-foreground/70">NULL</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
