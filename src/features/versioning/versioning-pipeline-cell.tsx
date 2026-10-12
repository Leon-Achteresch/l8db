import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineEntry } from "@/lib/versioning/pipeline";
import type { DatabaseTarget } from "@/lib/versioning/types";

const DOT = {
  current: "bg-emerald-500",
  pending: "bg-sky-500",
  blocked: "bg-amber-500",
  baseline: "bg-amber-500",
  paused: "bg-muted-foreground/50",
};

export function VersioningPipelineCell({
  entries,
  untested,
  onDeliver,
}: {
  entries: PipelineEntry[];
  untested?: boolean;
  onDeliver: (targets: DatabaseTarget[]) => void;
}) {
  if (!entries.length)
    return (
      <div className="flex min-h-12 items-center rounded-lg border border-dashed border-border/50 px-2.5 text-[11px] text-muted-foreground/70">
        –
      </div>
    );
  const pending = entries.filter((entry) => entry.progress.state === "pending");
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-background/70 p-2">
      {entries.map(({ target, progress }) => (
        <div key={target.id} className="flex min-w-0 items-center gap-2" title={progress.label}>
          <span className={cn("size-2 shrink-0 rounded-full", DOT[progress.state])} />
          <span className="min-w-0 flex-1 truncate text-[11px]">
            {target.environment || target.name}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-[10px]",
              progress.state === "current" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {target.release?.id ?? "?"}
          </span>
        </div>
      ))}
      {pending.length > 0 && (
        <Button
          size="sm"
          variant={untested ? "outline" : "default"}
          className="h-6 text-[11px]"
          title={
            untested ? "Dieser Release ist auf dem Testsystem noch nicht ausgerollt" : undefined
          }
          onClick={() => onDeliver(pending.map((entry) => entry.target))}
        >
          Ausrollen…
        </Button>
      )}
    </div>
  );
}
