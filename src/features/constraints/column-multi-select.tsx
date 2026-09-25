import { cn } from "@/lib/utils";

interface ColumnMultiSelectProps {
  columns: string[];
  value: string[];
  onChange: (value: string[]) => void;
  emptyText?: string;
  label: string;
}

export function ColumnMultiSelect({
  columns,
  value,
  onChange,
  emptyText = "Keine Spalten verfügbar.",
  label,
}: ColumnMultiSelectProps) {
  if (columns.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{emptyText}</p>;
  }
  return (
    <fieldset aria-label={label} className="flex flex-wrap gap-1">
      {columns.map((column) => {
        const position = value.indexOf(column);
        const selected = position >= 0;
        return (
          <button
            key={column}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              onChange(selected ? value.filter((c) => c !== column) : [...value, column])
            }
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
              selected
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {selected && (
              <span
                aria-hidden
                className="rounded bg-primary/20 px-1 text-[9px] font-semibold tabular-nums"
              >
                {position + 1}
              </span>
            )}
            {column}
          </button>
        );
      })}
    </fieldset>
  );
}
