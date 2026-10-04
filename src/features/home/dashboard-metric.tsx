import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const metricFormatter = new Intl.NumberFormat("de-DE");

interface Props {
  label: string;
  value?: number;
  loading: boolean;
  error: boolean;
  icon: LucideIcon;
}

export function DashboardMetric({ label, value, loading, error, icon: Icon }: Props) {
  return (
    <div className="flex min-w-0 flex-col justify-center px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-12" />
      ) : (
        <p
          className="mt-1 text-2xl font-semibold tracking-tight tabular-nums"
          title={error ? "Konnte nicht geladen werden" : undefined}
        >
          {error ? "—" : metricFormatter.format(value ?? 0)}
        </p>
      )}
    </div>
  );
}
