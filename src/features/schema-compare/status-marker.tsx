import type { DiffStatus } from "@/lib/schema-compare/types";
import { cn } from "@/lib/utils";

const MARKER: Record<
  Exclude<DiffStatus, "identical">,
  { letter: string; label: string; className: string }
> = {
  only_source: { letter: "N", label: "Neu", className: "text-emerald-600 dark:text-emerald-400" },
  different: { letter: "G", label: "Geändert", className: "text-amber-600 dark:text-amber-400" },
  only_target: { letter: "E", label: "Entfernt", className: "text-rose-600 dark:text-rose-400" },
};

export function StatusMarker({
  status,
  count,
  className,
}: {
  status: Exclude<DiffStatus, "identical">;
  count?: number;
  className?: string;
}) {
  const marker = MARKER[status];
  return (
    <span
      className={cn("font-mono text-[11px] font-medium tabular-nums", marker.className, className)}
      title={marker.label}
    >
      {marker.letter}
      {count !== undefined && ` ${count}`}
    </span>
  );
}
