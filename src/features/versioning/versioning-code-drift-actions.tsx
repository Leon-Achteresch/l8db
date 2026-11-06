import { Button } from "@/components/ui/button";
import type { DeploymentPlan } from "@/lib/versioning/deploy";

export function VersioningCodeDriftActions({
  plan,
  busy,
  onAdopt,
  onVariance,
  onOverride,
}: {
  plan: DeploymentPlan;
  busy: boolean;
  onAdopt: (objectId: string) => void;
  onVariance: (objectId: string) => void;
  onOverride: (objectId: string) => void;
}) {
  const drifting = [
    ...new Set(plan.code.filter((entry) => entry.action === "drift").map((entry) => entry.object)),
  ];
  if (!drifting.length) return null;
  const label = (id: string) =>
    plan.to.objects.find((entry) => entry.object.id === id)?.object.selection.objectName ?? id;
  return (
    <div className="space-y-1.5 text-foreground">
      {drifting.map((id) => (
        <div key={id} className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px]">{label(id)}</span>
          <span className="text-muted-foreground">beim Kunden direkt geändert</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={busy}
            onClick={() => onAdopt(id)}
          >
            Ins Repository übernehmen
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={busy}
            onClick={() => onVariance(id)}
          >
            Als Abweichung festhalten
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={busy}
            onClick={() => onOverride(id)}
          >
            Überschreiben freigeben
          </Button>
        </div>
      ))}
    </div>
  );
}
