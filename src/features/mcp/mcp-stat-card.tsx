import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface McpStatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext: string;
  status?: "default" | "active" | "warning";
  onClick?: () => void;
}

export function McpStatCard({
  icon: Icon,
  label,
  value,
  subtext,
  status = "default",
  onClick,
}: McpStatCardProps) {
  const isInteractive = Boolean(onClick);

  return (
    <motion.div
      whileHover={isInteractive ? { y: -2 } : undefined}
      whileTap={isInteractive ? { scale: 0.99 } : undefined}
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm backdrop-blur-sm transition-colors",
        isInteractive && "cursor-pointer hover:border-primary/40 hover:bg-card/90",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <div className="text-2xl font-bold tracking-tight text-foreground">{value}</div>
          <p className="text-[11px] text-muted-foreground/80">{subtext}</p>
        </div>
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl transition-colors",
            status === "active" && "bg-emerald-500/10 text-emerald-500",
            status === "warning" && "bg-amber-500/10 text-amber-500",
            status === "default" && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </motion.div>
  );
}
