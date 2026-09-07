import type { CsvCell } from "@/lib/csv-import";

interface CsvPreviewTableProps {
  headers: string[];
  rows: CsvCell[][];
}

export function CsvPreviewTable({ headers, rows }: CsvPreviewTableProps) {
  return (
    <div className="min-h-0 overflow-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted/60 backdrop-blur">
          <tr>
            <th className="w-10 border-b px-2 py-1 text-right font-medium text-muted-foreground">
              #
            </th>
            {headers.map((header, index) => (
              <th
                key={index}
                className="border-b px-2 py-1 text-left font-medium whitespace-nowrap"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-muted/20">
              <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                {rowIndex + 1}
              </td>
              {headers.map((_, colIndex) => {
                const value = row[colIndex] ?? null;
                return (
                  <td key={colIndex} className="max-w-64 truncate px-2 py-1 font-mono">
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
