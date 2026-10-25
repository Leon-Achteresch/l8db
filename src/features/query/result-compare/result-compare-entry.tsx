import { ArrowRightIcon } from "lucide-react";
import type { ColumnMask } from "@/lib/masking";
import { changeKeyLabel, compareCellText, type ResultChange } from "@/lib/result-compare";
import { cn } from "@/lib/utils";
import { CHANGE_TONE } from "./tone";

const PREVIEW_CELLS = 3;

export function ResultCompareEntry({
  change,
  keyColumns,
  columns,
  masks,
}: {
  change: ResultChange;
  keyColumns: string[];
  columns: string[];
  masks: ColumnMask[];
}) {
  const tone = CHANGE_TONE[change.kind];
  const shown = change.kind === "changed" ? change.changed : columns;
  const rest = shown.filter((column) => !keyColumns.includes(column));
  const cells = rest.slice(0, PREVIEW_CELLS);
  const more = rest.length - cells.length;
  const row = change.after ?? change.before ?? {};
  return (
    <>
      <span aria-hidden="true" className={cn("w-3 shrink-0 text-center font-mono", tone.text)}>
        {tone.glyph}
      </span>
      <span className="sr-only">{tone.label}: </span>
      <span className="max-w-[38%] shrink-0 truncate font-mono text-[11px] text-foreground/90">
        {changeKeyLabel(change, keyColumns, masks)}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap text-muted-foreground">
        {cells.map((column) => (
          <span key={column} className="flex min-w-0 shrink items-center gap-1">
            <span className="shrink-0">{column}</span>
            {change.kind === "changed" ? (
              <>
                <span className="truncate font-mono text-[11px] line-through decoration-muted-foreground/50">
                  {compareCellText(column, change.before?.[column], masks)}
                </span>
                <ArrowRightIcon aria-label="zu" className="size-3 shrink-0 text-primary/70" />
                <span className="truncate font-mono text-[11px] text-foreground">
                  {compareCellText(column, change.after?.[column], masks)}
                </span>
              </>
            ) : (
              <span className="truncate font-mono text-[11px] text-foreground/80">
                {compareCellText(column, row[column], masks)}
              </span>
            )}
          </span>
        ))}
        {more > 0 && <span className="shrink-0 text-[10px] tabular-nums">+{more}</span>}
      </span>
    </>
  );
}
