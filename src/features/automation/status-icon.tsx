import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockAlertIcon,
  SkipForwardIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react";
import { runStatusLabel } from "@/lib/automation/format";
import type { RunStatus } from "@/lib/db/automation";
import { cn } from "@/lib/utils";

interface Props {
  status: RunStatus | null;
  className?: string;
  label?: boolean;
}

const ICONS = {
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  failed: CircleXIcon,
  timeout: ClockAlertIcon,
  cancelled: BanIcon,
  skipped: SkipForwardIcon,
  interrupted: UnplugIcon,
} as const;

const COLORS: Record<RunStatus, string> = {
  running: "text-primary",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  failed: "text-destructive",
  timeout: "text-destructive",
  cancelled: "text-muted-foreground",
  skipped: "text-muted-foreground",
  interrupted: "text-amber-600 dark:text-amber-400",
};

export function StatusIcon({ status, className, label }: Props) {
  const text = status ? runStatusLabel(status) : "noch nie gelaufen";
  if (status === "running")
    return (
      <span
        role="img"
        aria-label={label ? undefined : text}
        className={cn("relative inline-flex size-3.5 shrink-0", className)}
      >
        <span className="absolute inset-0 rounded-full border-[1.5px] border-primary/20" />
        <span className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-transparent border-t-primary motion-reduce:animate-none" />
      </span>
    );
  const Icon = status ? ICONS[status] : CircleDashedIcon;
  return (
    <Icon
      role="img"
      aria-label={label ? undefined : text}
      aria-hidden={label ? true : undefined}
      className={cn(
        "size-3.5 shrink-0",
        status ? COLORS[status] : "text-muted-foreground/60",
        className,
      )}
    />
  );
}
