import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  label: string;
  value?: number;
  loading: boolean;
  error: boolean;
  icon: LucideIcon;
}

export function DashboardMetric({ label, value, loading, error, icon: Icon }: Props) {
  return (
    <motion.div layout transition={{ layout: SPRING_LAYOUT }} className="min-w-0 px-5 py-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 text-primary" />
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-12" />
      ) : (
        <p
          className="mt-2 text-3xl font-medium tracking-tight"
          title={error ? "Konnte nicht geladen werden" : undefined}
        >
          {error ? "—" : (value ?? 0).toLocaleString("de-DE")}
        </p>
      )}
    </motion.div>
  );
}
