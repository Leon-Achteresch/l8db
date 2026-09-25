import type { DatagenPreview } from "@/lib/db";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DatagenPreviewTable({ preview }: { preview: DatagenPreview }) {
  return (
    <div className="space-y-2">
      <div className="max-h-64 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {preview.columns.map((column) => (
                <th key={column} className="px-2 py-1 text-left font-mono font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={index} className="border-t">
                {preview.columns.map((column) => (
                  <td
                    key={column}
                    className={`max-w-56 truncate px-2 py-1 font-mono ${row[column] === null ? "text-muted-foreground italic" : ""}`}
                  >
                    {cellText(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.statement && (
        <pre className="max-h-24 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[10px] whitespace-pre-wrap break-all">
          {preview.statement}
        </pre>
      )}
    </div>
  );
}
