import { cn } from "@/lib/utils";

export function PrivBar({ granted, total }: { granted: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((granted / total) * 100);
  return (
    <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          pct === 0 ? "bg-muted" : pct === 100 ? "bg-emerald-500" : "bg-amber-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
