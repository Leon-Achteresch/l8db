import { ArrowRight } from "lucide-react";
import {
  formatUsageActivity,
  formatUsageCount,
  type UsageStatisticsSummary,
} from "@/features/settings/usage-statistics-format";
import { usageViewLabel } from "@/lib/usage-statistics";

interface Props {
  summary: UsageStatisticsSummary;
}

export function SettingsUsageAreas({ summary }: Props) {
  return (
    <div className="grid gap-4 @min-[38rem]:grid-cols-2">
      <section className="rounded-xl border p-4" aria-labelledby="usage-areas-heading">
        <h3 id="usage-areas-heading" className="text-sm font-medium">
          Häufig genutzte Bereiche
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">Bis zu 8 Bereiche nach Aufrufen.</p>
        {summary.areas.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">Noch keine Bereiche erfasst.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {summary.areas.map((area) => (
              <li key={area.view} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate" title={usageViewLabel(area.view)}>
                  {usageViewLabel(area.view)}
                </span>
                <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                  {formatUsageCount(area.opens)} Aufrufe · {formatUsageActivity(area.activeMs)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border p-4" aria-labelledby="usage-paths-heading">
        <h3 id="usage-paths-heading" className="text-sm font-medium">
          Häufige Bedienwege
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">Bis zu 8 Wechsel zwischen Bereichen.</p>
        {summary.paths.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">Wechsle Bereiche, um Wege zu sehen.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {summary.paths.map((path) => (
              <li key={`${path.from}:${path.to}`} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1">
                  {usageViewLabel(path.from)}
                  <ArrowRight aria-hidden="true" className="mx-1 inline size-3" />
                  {usageViewLabel(path.to)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatUsageCount(path.count)}×
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
