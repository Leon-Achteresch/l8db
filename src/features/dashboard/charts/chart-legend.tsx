import { cn } from "@/lib/utils";
import type { LegendItem } from "./chart-summary";

export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <span key={item.name} className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "shrink-0",
              item.line ? "h-0.5 w-3 rounded-full" : "size-2 rounded-[2px]",
            )}
            style={{ background: item.color }}
          />
          <span className="truncate">{item.name}</span>
        </span>
      ))}
    </div>
  );
}
