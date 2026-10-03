import type { AiTable } from "@/lib/ai/result";

export function AiResultTable({ table }: { table: AiTable }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-collapse text-left text-xs tabular-nums">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col" className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={String(index)} className="border-t border-border/60">
              {table.columns.map((column) => (
                <td
                  key={column}
                  className="max-w-64 truncate px-2.5 py-1"
                  title={row[column] ?? ""}
                >
                  {row[column] ?? <span className="text-muted-foreground">NULL</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
