import { cn } from "@/lib/utils";
import type { CellBadge } from "@/lib/value-viewers/detect";

const BADGE_CLASSES: Record<CellBadge["kind"], string> = {
  binary: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  image: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  geometry: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  vector: "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  xml: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

export function DataTableCellBadge({ badge }: { badge: CellBadge }) {
  return (
    <span
      title={badge.title}
      data-cell-badge={badge.kind}
      className={cn(
        "mr-1.5 inline-block rounded-sm border px-1 align-[1px] font-sans text-[9px] leading-[13px] font-semibold tracking-wide",
        BADGE_CLASSES[badge.kind],
      )}
    >
      {badge.label}
    </span>
  );
}
