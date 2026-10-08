import type { CsvCell } from "@/lib/csv-import";
import { cn } from "@/lib/utils";

interface CsvPreviewTableProps {
  headers: string[];
  rows: CsvCell[][];
  numeric?: boolean[];
}

export function CsvPreviewTable({ headers, rows, numeric = [] }: CsvPreviewTableProps) {
  return (
    <div className="min-h-0 overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-background text-xs">
          <tr>
            <th className="w-10 border-b px-2 py-1 text-right font-medium text-muted-foreground">
              #
            </th>
            {headers.map((header, index) => (
              <th
                key={index}
                className={cn(
                  "border-b px-2 py-1.5 font-medium whitespace-nowrap",
                  numeric[index] ? "text-right" : "text-left",
                )}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/50 hover:bg-muted/30">
              <td className="w-10 px-2 py-1 text-right font-mono text-muted-foreground tabular-nums">
                {rowIndex + 1}
              </td>
              {headers.map((_, colIndex) => {
                const value = row[colIndex] ?? null;
                return (
                  <td
                    key={colIndex}
                    className={cn(
                      "max-w-64 truncate px-2 py-1 font-mono",
                      numeric[colIndex] && "text-right tabular-nums",
                    )}
                  >
                    {value === null ? (
                      <span className="text-muted-foreground italic">NULL</span>
                    ) : value === "" ? (
                      <span className="text-muted-foreground">&quot;&quot;</span>
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
