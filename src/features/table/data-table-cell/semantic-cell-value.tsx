import { CheckIcon } from "lucide-react";
import { Fragment } from "react";
import { CATEGORY_PILL_CLASSES } from "@/lib/category-colors";
import {
  categoryColorIndex,
  jsonEntries,
  shortUuid,
  splitEmail,
  timestampDisplay,
} from "@/lib/grid-cell-format";
import type { TableCellPreview } from "@/lib/table-cell-preview";
import { cn } from "@/lib/utils";
import type { GridColumnStyle } from "../data-table/grid-style-context";

type Props = {
  value: unknown;
  preview: TableCellPreview;
  column: GridColumnStyle | undefined;
  now: Date;
};

export function SemanticCellValue({ value, preview, column, now }: Props) {
  if (value === null || value === undefined)
    return (
      <span className="rounded border border-dashed border-muted-foreground/30 px-1 font-mono text-[10.5px] text-muted-foreground/70">
        null
      </span>
    );
  if (typeof value === "boolean" || column?.kind === "boolean") {
    const truthy = value === true || value === "true" || value === 1 || value === "t";
    return truthy ? (
      <CheckIcon
        aria-label="true"
        className="inline size-3.5 text-emerald-600 dark:text-emerald-400"
      />
    ) : (
      <span title="false" className="text-muted-foreground/50">
        —
      </span>
    );
  }
  if (column?.categorical && typeof value === "string")
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 font-sans text-[11px] leading-[18px] font-medium",
          CATEGORY_PILL_CLASSES[categoryColorIndex(value)],
        )}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
        <span className="truncate">{preview.text}</span>
      </span>
    );
  if (column?.primaryKey)
    return <span className="font-mono text-amber-600 dark:text-amber-400">{preview.text}</span>;
  if (column?.numeric || preview.kind === "number")
    return <span className="font-mono tabular-nums text-foreground">{preview.text}</span>;
  if (preview.kind === "uuid") {
    const short = shortUuid(String(value));
    return (
      <span className="font-mono text-foreground/85">
        {short.slice(0, 8)}
        <span className="text-muted-foreground/60">{short.slice(8)}</span>
      </span>
    );
  }
  if (column?.kind === "date" && typeof value === "string") {
    const display = timestampDisplay(value, now);
    if (display)
      return (
        <span title={value}>
          {display.primary}
          {display.secondary ? (
            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground/70">
              {display.secondary}
            </span>
          ) : null}
        </span>
      );
  }
  if (typeof value === "object") {
    const entries = jsonEntries(value);
    if (!entries)
      return <span className="text-violet-600 dark:text-violet-400">{preview.text}</span>;
    return (
      <span>
        {entries.map(([key, entry], index) => (
          <Fragment key={key}>
            {index > 0 ? <span className="text-muted-foreground/50"> · </span> : null}
            <span className="text-violet-600 dark:text-violet-400">{key}</span>
            <span className="ml-1">{entry}</span>
          </Fragment>
        ))}
      </span>
    );
  }
  const email = typeof value === "string" ? splitEmail(preview.text) : null;
  if (email)
    return (
      <span>
        {email[0]}
        <span className="text-muted-foreground/70">{email[1]}</span>
      </span>
    );
  return preview.text;
}
