import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/versioning/delivery";
import type { PipelineStage } from "@/lib/versioning/pipeline";
import type { DatabaseRelease } from "@/lib/versioning/types";

function tone(stage: PipelineStage) {
  if (!stage.total) return "idle";
  if (stage.current === stage.total) return "done";
  if (stage.blocked) return "blocked";
  return stage.pending ? "pending" : "idle";
}

const DOT = {
  done: "bg-emerald-500",
  pending: "bg-sky-500",
  blocked: "bg-amber-500",
  idle: "bg-muted-foreground/40",
};

export function VersioningPipelineStages({
  tip,
  committed,
  stages,
}: {
  tip: DatabaseRelease | null;
  committed: boolean;
  stages: PipelineStage[];
}) {
  return (
    <ol aria-label="Pipeline" className="flex flex-wrap items-center gap-1">
      <li
        className={cn(
          "flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs",
          committed ? "border-emerald-500/30" : "border-dashed border-border",
        )}
      >
        {committed ? (
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <span className="size-2 rounded-full bg-muted-foreground/40" />
        )}
        <span className="font-medium">Release</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {tip ? `${tip.id}${committed ? "" : " · Entwurf"}` : "keiner"}
        </span>
      </li>
      {stages.map((stage) => {
        const state = tone(stage);
        return (
          <Fragment key={stage.stage}>
            <ChevronRightIcon aria-hidden className="size-3.5 text-muted-foreground/60" />
            <li
              className={cn(
                "flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs",
                state === "done" ? "border-emerald-500/30" : "border-border/70",
                !stage.total && "border-dashed text-muted-foreground",
              )}
            >
              <span className={cn("size-2 rounded-full", DOT[state])} />
              <span className="font-medium">{STAGE_LABELS[stage.stage]}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {stage.total ? `${stage.current}/${stage.total}` : "–"}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
