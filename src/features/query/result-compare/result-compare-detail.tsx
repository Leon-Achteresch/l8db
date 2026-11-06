import type { ColumnMask } from "@/lib/masking";
import { changeKeyLabel, compareCellText, type ResultChange } from "@/lib/result-compare";
import { cn } from "@/lib/utils";
import { CHANGE_TONE } from "./tone";

export function ResultCompareDetail({
  change,
  keyColumns,
  columns,
  masks,
}: {
  change: ResultChange | null;
  keyColumns: string[];
  columns: string[];
  masks: ColumnMask[];
}) {
  if (!change) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Wähle links einen Unterschied, um die ganze Zeile vorher und jetzt zu sehen.
      </div>
    );
  }
  const tone = CHANGE_TONE[change.kind];
  const value = (row: Record<string, unknown> | null, column: string) =>
    row && column in row ? compareCellText(column, row[column], masks) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
        <span className={cn("font-medium", tone.text)}>{tone.label}</span>
        <span className="truncate font-mono text-[11px] text-foreground/90">
          {changeKeyLabel(change, keyColumns, masks)}
        </span>
        {change.kind === "changed" && (
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {change.changed.length} {change.changed.length === 1 ? "Spalte" : "Spalten"}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <caption className="sr-only">
            {tone.label} {changeKeyLabel(change, keyColumns, masks)}: Werte vorher und jetzt
          </caption>
          <thead className="sticky top-0 bg-card text-[11px] text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="w-[30%] px-3 py-1.5 text-left font-medium">
                Spalte
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Vorher
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Jetzt
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => {
              const changed = change.changed.includes(column);
              const before = value(change.before, column);
              const after = value(change.after, column);
              return (
                <tr
                  key={column}
                  className={cn(
                    "border-b border-border/40 align-top",
                    changed && tone.wash,
                    !changed && change.kind === "changed" && "text-muted-foreground",
                  )}
                >
                  <th
                    scope="row"
                    className={cn(
                      "truncate border-l-2 px-3 py-1 text-left font-normal",
                      changed ? tone.edge : "border-l-transparent",
                    )}
                    title={column}
                  >
                    {column}
                  </th>
                  <td className="px-2 py-1 font-mono text-[11px] break-all whitespace-pre-wrap">
                    {before ?? <span className="text-muted-foreground/60">–</span>}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 font-mono text-[11px] break-all whitespace-pre-wrap",
                      changed && "text-foreground",
                    )}
                  >
                    {after ?? <span className="text-muted-foreground/60">–</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
