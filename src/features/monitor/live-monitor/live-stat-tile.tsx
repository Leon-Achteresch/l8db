import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LiveStatTile({
  label,
  value,
  suffix,
  icon: Icon,
  progress,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  icon: LucideIcon;
  progress?: number | null;
  tone?: "default" | "warning" | "danger";
  hint?: string;
}) {
  const width = progress == null ? null : Math.min(100, Math.max(progress > 0 ? 2 : 0, progress));
  return (
    <div className="min-w-0 rounded-xl border bg-card px-4 py-3.5" title={hint}>
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <p className="mt-1 flex items-baseline gap-2 truncate">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        {suffix ? <span className="truncate text-xs text-muted-foreground">{suffix}</span> : null}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        {width != null && (
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              tone === "danger"
                ? "bg-destructive"
                : tone === "warning"
                  ? "bg-amber-500"
                  : "bg-foreground/70",
            )}
            style={{ width: `${width}%` }}
          />
        )}
      </div>
    </div>
  );
}
