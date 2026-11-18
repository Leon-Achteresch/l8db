import { NewBadge } from "@/components/new-badge";
import type { IndexObservation } from "@/lib/db/health";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const utcFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

export function HealthIndexObservation({ observation }: { observation?: IndexObservation }) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>(
    "health.advisor.index-observation",
  );
  const resetAt = observation?.databaseStatsResetAt;
  const date = resetAt ? new Date(resetAt) : null;
  const label = date && Number.isFinite(+date) ? `${utcFormat.format(date)} UTC` : null;

  return (
    <div ref={ref} className="space-y-1 rounded-md bg-background/60 px-3 py-2 text-xs">
      <dl
        aria-label="Index-Beobachtungsbasis"
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
      >
        <dt className="flex items-baseline gap-1.5 text-muted-foreground">
          Reset-Zeitstempel der Datenbankstatistik
          {isNew && <NewBadge />}
        </dt>
        <dd className="font-medium tabular-nums">
          {label && resetAt ? <time dateTime={resetAt}>{label}</time> : "Unbekannt"}
        </dd>
      </dl>
      {observation?.tracksCounts === false && (
        <p className="text-muted-foreground">Statistikerfassung in dieser Sitzung deaktiviert.</p>
      )}
      {observation?.tracksCounts == null && (
        <p className="text-muted-foreground">Statistikerfassung unbekannt.</p>
      )}
    </div>
  );
}
