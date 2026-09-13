import { XIcon } from "lucide-react";
import { useTableRowCountQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface TableViewChipProps {
  schema: string;
  table: string;
  label: string;
  filter: string;
  filterRaw?: boolean;
  color: string;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}

export function TableViewChip({
  schema,
  table,
  label,
  filter,
  filterRaw,
  color,
  active,
  onSelect,
  onRemove,
}: TableViewChipProps) {
  const count = useTableRowCountQuery(schema, table, filter, filterRaw);
  return (
    <div
      className={cn(
        "group flex shrink-0 items-center rounded-full px-1 text-sm",
        active ? "border bg-background shadow-xs" : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className="flex items-center gap-1.5 rounded-full px-2 py-1 focus-visible:outline-2"
      >
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span>{label}</span>
        {count.data !== undefined && (
          <span className="text-xs text-muted-foreground">
            {Intl.NumberFormat("de-DE", { notation: "compact" }).format(count.data)}
          </span>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Ansicht ${label} entfernen`}
          onClick={onRemove}
          className="rounded-full p-1 opacity-50 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
