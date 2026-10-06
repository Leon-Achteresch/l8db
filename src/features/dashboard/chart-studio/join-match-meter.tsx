import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JoinStats } from "./studio-model";

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function JoinMatchMeter({
  stats,
  loading,
  error,
  compact,
  baseLabel,
}: {
  stats: JoinStats | null;
  loading: boolean;
  error: boolean;
  compact?: boolean;
  baseLabel: string;
}) {
  if (error)
    return (
      <p className="text-[11px] text-muted-foreground">Trefferquote konnte nicht geprüft werden.</p>
    );
  if (!stats)
    return (
      <div className="space-y-1" aria-busy={loading}>
        <div className="h-1.5 w-full animate-pulse rounded-full bg-muted" />
        {!compact && <p className="text-[11px] text-muted-foreground">Prüfe Stichprobe…</p>}
      </div>
    );
  const rate = stats.sample ? stats.matched / stats.sample : 0;
  const tone = rate >= 0.8 ? "bg-emerald-500" : rate >= 0.4 ? "bg-amber-500" : "bg-rose-500";
  const multiplies = stats.fanout > 1.05;
  return (
    <div className="space-y-1.5">
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone)}
          style={{ width: `${Math.max(2, rate * 100)}%` }}
        />
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground tabular-nums">
        <span>
          <span className="font-semibold text-foreground">{Math.round(rate * 100)} %</span> der{" "}
          {compact ? "Zeilen" : `${baseLabel}-Zeilen`} finden einen Partner
        </span>
        {!compact && <span>Stichprobe {number.format(stats.sample)} Zeilen</span>}
      </p>
      {multiplies && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          <span>
            Jede Zeile trifft im Schnitt {number.format(stats.fanout)} Partner. Summen werden
            dadurch größer. Ergänze eine weitere Bedingung oder zähle eindeutige Werte.
          </span>
        </p>
      )}
    </div>
  );
}
