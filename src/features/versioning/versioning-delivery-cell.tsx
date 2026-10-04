import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/versioning/delivery";
import { releaseTrack } from "@/lib/versioning/model";
import type {
  DatabaseRelease,
  DatabaseTarget,
  RepositoryStatus,
  TargetStage,
} from "@/lib/versioning/types";
import { targetProgress } from "@/lib/versioning/workflow";

export function VersioningDeliveryCell({
  stage,
  targets,
  releases,
  status,
  tested,
  onDeliver,
}: {
  stage: TargetStage;
  targets: DatabaseTarget[];
  releases: DatabaseRelease[];
  status: RepositoryStatus | null;
  tested?: string[];
  onDeliver: (targets: DatabaseTarget[]) => void;
}) {
  if (!targets.length)
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
        Kein {STAGE_LABELS[stage]}system zugeordnet
      </div>
    );
  const pending = targets.filter(
    (target) => targetProgress(target, releases, status).state === "pending",
  );
  const next = releases
    .filter((release) => releaseTrack(release) === (pending[0]?.track ?? "main"))
    .at(-1)?.id;
  const untested = Boolean(tested && next && pending.length && !tested.includes(next));
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-background/70 p-3">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {STAGE_LABELS[stage]}
      </p>
      {targets.map((target) => {
        const progress = targetProgress(target, releases, status);
        return (
          <div key={target.id} className="min-w-0">
            <p className="truncate text-xs font-medium">{target.environment || target.name}</p>
            <p
              className={cn(
                "truncate text-[10px]",
                progress.state === "pending" ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className="font-mono">{target.release?.id ?? "Ohne Baseline"}</span> ·{" "}
              {progress.label}
            </p>
          </div>
        );
      })}
      {tested && (
        <p
          className={cn(
            "text-[10px] leading-relaxed",
            untested ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {tested.length
            ? `Testsystem steht auf ${tested.join(", ")}`
            : "Testsystem hat noch keinen Stand"}
          {untested && ` · ${next} ist dort noch nicht ausgeliefert`}
        </p>
      )}
      <Button
        size="sm"
        variant={pending.length ? "default" : "outline"}
        className="mt-auto h-7 text-[11px]"
        disabled={!pending.length}
        onClick={() => onDeliver(pending)}
      >
        {pending.length ? `Ausliefern (${pending.length})…` : "Aktuell"}
      </Button>
    </div>
  );
}
