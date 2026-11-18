import { NewBadge } from "@/components/new-badge";
import type { IndexBuildProgress } from "@/lib/db/replication";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const labels: Record<IndexBuildProgress["counters"][number]["unit"], string> = {
  blocks: "Blöcke",
  tuples: "Tupel",
  lockers: "Abgewartete Sperrhalter",
};

export function LiveIndexBuildProgress({ progress }: { progress: IndexBuildProgress }) {
  const feature = useNewFeatureVisibility<HTMLElement>("monitor.sessions.index-progress");
  if (!progress.phase?.trim()) return null;

  return (
    <section
      ref={feature.ref}
      aria-label="Indexfortschritt"
      className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="font-medium">Indexfortschritt</h4>
        {progress.command && (
          <span className="font-mono text-[11px] wrap-anywhere text-muted-foreground">
            {progress.command}
          </span>
        )}
        {feature.isNew && <NewBadge />}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Phase</dt>
        <dd className="font-mono wrap-anywhere">{progress.phase}</dd>
      </dl>
      {progress.counters?.length > 0 && (
        <dl
          aria-label="Zähler dieser Phase"
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-3 gap-y-1"
        >
          {progress.counters.map(({ unit, done, total }) =>
            Object.hasOwn(labels, unit) ? (
              <div key={unit} className="contents">
                <dt className="text-muted-foreground">{labels[unit]}</dt>
                <dd className="text-right font-mono wrap-anywhere tabular-nums">
                  {total ? `${done} / ${total}` : done}
                </dd>
              </div>
            ) : null,
          )}
        </dl>
      )}
    </section>
  );
}
