import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { CodeState, CodeStatus } from "@/lib/versioning/code-drift";
import type { DatabaseTarget } from "@/lib/versioning/types";

const LABELS: Record<CodeState, string> = {
  current: "Aktuell",
  variance: "Abweichung",
  pending: "Update offen",
  drift: "Direkt geändert",
  missing: "Fehlt",
};

export function VersioningCodeDriftReport({
  rows,
  problems,
  targets,
  busy,
  onVariance,
  onAdopt,
  onClose,
}: {
  rows: CodeStatus[];
  problems: { target: string; error: string }[];
  targets: DatabaseTarget[];
  busy: boolean;
  onVariance: (row: CodeStatus) => void;
  onAdopt: (row: CodeStatus) => void;
  onClose: () => void;
}) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.targets.code-drift");
  const name = (id: string) => targets.find((target) => target.id === id)?.name ?? id;
  const open = rows.filter((row) => row.state === "drift" || row.state === "missing");
  const counts = Object.fromEntries(
    (Object.keys(LABELS) as CodeState[]).map((state) => [
      state,
      rows.filter((row) => row.state === state).length,
    ]),
  ) as Record<CodeState, number>;
  return (
    <section
      ref={feature.ref}
      aria-label="Code-Drift aller Kunden"
      className="space-y-3 rounded-lg bg-muted/30 p-4 text-xs"
    >
      <div className="flex items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-semibold">
          Programmcode bei allen Kunden{feature.isNew && <NewBadge />}
        </h2>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onClose}>
          Schließen
        </Button>
      </div>
      <p className="text-muted-foreground">
        {(Object.keys(LABELS) as CodeState[])
          .map((state) => `${counts[state]} ${LABELS[state]}`)
          .join(" · ")}
      </p>
      {open.length === 0 && <p>Kein direkt geänderter Programmcode gefunden.</p>}
      {open.map((row) => (
        <div key={`${row.target}:${row.object}`} className="flex flex-wrap items-center gap-2">
          <span className="w-40 truncate">{name(row.target)}</span>
          <span className="font-mono text-[11px]">{row.label}</span>
          <span className="text-amber-600 dark:text-amber-400">{LABELS[row.state]}</span>
          {row.state === "drift" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy}
                onClick={() => onAdopt(row)}
              >
                Ins Repository übernehmen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy}
                onClick={() => onVariance(row)}
              >
                Als Abweichung festhalten
              </Button>
            </>
          )}
        </div>
      ))}
      {problems.map((problem) => (
        <p key={problem.target} className="text-destructive">
          {name(problem.target)}: {problem.error}
        </p>
      ))}
    </section>
  );
}
