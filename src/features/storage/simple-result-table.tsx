function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function SimpleResultTable({
  columns,
  rows,
  maxRows = 500,
}: {
  columns: string[];
  rows: unknown[][];
  maxRows?: number;
}) {
  return (
    <div className="max-h-full overflow-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {columns.map((column, index) => (
              <th
                key={`${column}-${index}`}
                className="border-b px-2 py-1 text-left font-medium whitespace-nowrap"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, maxRows).map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-muted/30">
              {columns.map((column, index) => (
                <td
                  key={`${column}-${index}`}
                  className="max-w-72 truncate border-b px-2 py-1 font-mono"
                  title={cellText(row[index])}
                >
                  {cellText(row[index])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows ? (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          {maxRows} von {rows.length} Zeilen angezeigt.
        </p>
      ) : null}
    </div>
  );
}
