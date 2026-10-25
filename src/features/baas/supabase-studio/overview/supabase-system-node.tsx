import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusLabel } from "../supabase-services";

export function SupabaseSystemNode({
  icon: Icon,
  label,
  metric,
  status,
  healthy,
  disabledReason,
  onOpen,
  className,
}: {
  icon: LucideIcon;
  label: string;
  metric?: string;
  status?: string;
  healthy?: boolean;
  disabledReason?: string | null;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen || Boolean(disabledReason)}
      title={disabledReason ?? undefined}
      className={cn(
        "group relative flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-[border-color,box-shadow,transform] duration-150 enabled:hover:-translate-y-px enabled:hover:border-primary/40 enabled:hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60 motion-reduce:transition-none motion-reduce:enabled:hover:translate-y-0",
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {label}
          {healthy !== undefined && (
            <span
              className={cn("size-1.5 rounded-full", healthy ? "bg-emerald-500" : "bg-amber-500")}
            />
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {disabledReason ?? (status ? statusLabel(status) : " ")}
        </span>
      </span>
      {metric && (
        <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{metric}</span>
      )}
    </button>
  );
}
