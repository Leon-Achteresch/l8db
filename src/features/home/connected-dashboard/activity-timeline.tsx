import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import type { Activity } from "../activity";

export function ActivityTimeline({
  activity,
  highlight,
}: {
  activity: Activity;
  highlight: string | null;
}) {
  const feature = useNewFeatureVisibility<HTMLElement>("home.activity");
  const errors = useMemo(
    () => activity.points.filter((point) => point.error).length,
    [activity.points],
  );
  const focused = activity.points.find((point) => point.id === highlight);
  const dots = useMemo(
    () =>
      activity.points.map((point) => (
        <span
          key={point.id}
          title={point.label}
          className={cn(
            "absolute size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full",
            point.error ? "bg-destructive" : "bg-primary/55",
          )}
          style={{ left: `${point.x * 100}%`, bottom: `${point.y * 100}%` }}
        />
      )),
    [activity.points],
  );
  return (
    <figure ref={feature.ref} className="relative mb-3 shrink-0">
      {feature.isNew && <NewBadge className="absolute right-2 top-1.5 z-20" />}
      <figcaption className="sr-only">
        Die letzten {activity.points.length} Abfragen der vergangenen 7 Tage, davon {errors}{" "}
        fehlgeschlagen. Höhe zeigt die Laufzeit.
      </figcaption>
      <div
        aria-hidden="true"
        className="relative h-16 rounded-xl border bg-[repeating-linear-gradient(to_top,transparent_0,transparent_19px,color-mix(in_oklch,var(--border)_55%,transparent)_19px,color-mix(in_oklch,var(--border)_55%,transparent)_20px)]"
      >
        <span className="absolute left-2 top-1.5 text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
          langsam
        </span>
        <div className="absolute inset-x-3 bottom-5 top-4">
          {activity.days.map((day) => (
            <span
              key={day.x}
              className="absolute -bottom-5 top-0 border-l border-dashed border-border"
              style={{ left: `${day.x * 100}%` }}
            >
              <span className="absolute bottom-0.5 left-1 text-[9px] text-muted-foreground">
                {day.label}
              </span>
            </span>
          ))}
          {dots}
          {focused && (
            <span
              className={cn(
                "absolute z-10 size-3 -translate-x-1/2 translate-y-1/2 rounded-full ring-4 ring-primary/20",
                focused.error ? "bg-destructive" : "bg-primary",
              )}
              style={{ left: `${focused.x * 100}%`, bottom: `${focused.y * 100}%` }}
            />
          )}
        </div>
      </div>
    </figure>
  );
}
