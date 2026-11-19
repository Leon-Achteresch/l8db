import { Code2Icon, SlidersHorizontalIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import type { FilterMode } from "@/features/table/table-filter-panel/filter-types";
import { useActiveConnection } from "@/lib/connections";
import { useHasNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";

export function FilterModeToggle({
  mode,
  sqlLabel,
  onChange,
}: {
  mode: FilterMode;
  sqlLabel: string;
  onChange: (mode: FilterMode) => void;
}) {
  const kind = useActiveConnection()?.kind;
  const hasNewGrouping = useHasNewFeatures("table.filter.grouping");
  return (
    <fieldset
      aria-label="Filtermodus"
      className="m-0 flex h-6 min-w-0 shrink-0 items-stretch overflow-hidden rounded-md border border-border/80 bg-background/40 p-0 text-2xs font-medium"
    >
      {(["simple", "sql"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          title={
            value === "simple"
              ? "Filter aus Bausteinen zusammensetzen"
              : `Filter als ${sqlLabel}-Ausdruck schreiben`
          }
          onClick={() => onChange(value)}
          className={cn(
            "flex items-center gap-1 px-2 outline-none transition-colors focus-visible:bg-muted focus-visible:text-foreground",
            value === "sql" && "border-l border-border/80",
            mode === value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          {value === "simple" ? (
            <SlidersHorizontalIcon className="size-3" />
          ) : (
            <Code2Icon className="size-3" />
          )}
          {value === "simple" ? "Einfach" : sqlLabel}
          {value === "sql" && mode === "simple" && kind === "postgres" && hasNewGrouping ? (
            <span aria-hidden="true">
              <NewBadge />
            </span>
          ) : null}
        </button>
      ))}
    </fieldset>
  );
}
