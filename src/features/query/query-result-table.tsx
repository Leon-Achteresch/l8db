import type { QueryResult } from "@/lib/db";
import { cn } from "@/lib/utils";

interface QueryResultTableProps {
  result: QueryResult | null;
  isLoading: boolean;
  error: string | null;
}

export function QueryResultTable({ result, isLoading, error }: QueryResultTableProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <svg
            className="size-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            role="img"
            aria-label="Wird ausgeführt"
          >
            <title>Wird ausgeführt</title>
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Ausführen…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-start gap-2 overflow-auto p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-destructive">Fehler</span>
        <pre className="whitespace-pre-wrap font-mono text-sm text-destructive">{error}</pre>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Drücke{" "}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">⌘ Enter</kbd> um
          die Abfrage auszuführen.
        </p>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {result.rows_affected !== null && result.rows_affected !== undefined
            ? `${result.rows_affected} Zeile${result.rows_affected === 1 ? "" : "n"} betroffen`
            : "Kein Ergebnis"}
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 min-w-12 border-b border-r bg-muted px-3 py-1.5 text-right text-xs font-medium text-muted-foreground">
              #
            </th>
            {result.columns.map((col) => (
              <th
                key={col}
                className="border-b border-r bg-muted px-3 py-1.5 text-left text-xs font-medium text-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className={cn(
                "group hover:bg-muted/50",
                rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20",
              )}
            >
              <td className="sticky left-0 border-b border-r bg-inherit px-3 py-1 text-right font-mono text-xs text-muted-foreground">
                {rowIdx + 1}
              </td>
              {result.columns.map((col) => {
                const raw = row[col];
                const isNull = raw === null || raw === undefined;
                const display = isNull
                  ? "NULL"
                  : String(raw).length > 200
                    ? `${String(raw).slice(0, 200)}…`
                    : String(raw);
                return (
                  <td
                    key={col}
                    title={isNull ? undefined : String(raw)}
                    className={cn(
                      "max-w-xs overflow-hidden text-ellipsis whitespace-nowrap border-b border-r px-3 py-1 font-mono text-xs",
                      isNull && "text-muted-foreground/50 italic",
                    )}
                  >
                    {display}
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
