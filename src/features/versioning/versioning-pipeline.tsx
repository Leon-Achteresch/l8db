import { ArrowRightIcon, PlusIcon, Undo2Icon, WorkflowIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "@/lib/versioning/delivery";
import {
  buildPipeline,
  PIPELINE_STAGES,
  pipelineNextStep,
  releaseTracks,
} from "@/lib/versioning/pipeline";
import type { DatabaseTarget } from "@/lib/versioning/types";
import type { VersioningArea } from "@/lib/versioning/workflow";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningCustomerCreate } from "./versioning-customer-create";
import { VersioningPipelineCell } from "./versioning-pipeline-cell";
import { VersioningPipelineStages } from "./versioning-pipeline-stages";
import { VersioningRemoteBanner } from "./versioning-remote-banner";

export function VersioningPipeline({
  workspace,
  onNavigate,
}: {
  workspace: VersioningWorkspace;
  onNavigate: (area: VersioningArea) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.pipeline");
  const { project, releases, targets, status } = workspace;
  const list = useMemo(() => targets?.targets ?? [], [targets]);
  const tracks = useMemo(() => releaseTracks(releases, list), [releases, list]);
  const [chosen, setChosen] = useState<string | null>(null);
  const track =
    chosen && tracks.includes(chosen)
      ? chosen
      : (tracks.find((entry) => list.some((target) => (target.track ?? "main") === entry)) ??
        "main");
  const pipeline = useMemo(
    () => buildPipeline(list, releases, status, track),
    [list, releases, status, track],
  );
  const [creating, setCreating] = useState(false);
  if (!project) return null;
  const next = pipelineNextStep(project, status, releases, list);
  const deliver = (chosenTargets: DatabaseTarget[]) => {
    workspace.setRequestedTargetIds(chosenTargets.map((target) => target.id));
    if (pipeline.tip) workspace.setRequestedReleaseId(pipeline.tip.id);
    onNavigate("targets");
  };
  const pendingIn = (stage: "test" | "production") =>
    pipeline.rows.flatMap((row) =>
      row.cells[stage]
        .filter((entry) => entry.progress.state === "pending")
        .map((entry) => entry.target),
    );
  const pendingTest = pendingIn("test");
  const pendingProduction = pendingIn("production");
  return (
    <section ref={feature.ref} className="space-y-4" aria-label="Pipeline">
      <header className="flex flex-wrap items-center gap-2">
        <WorkflowIcon className="size-4 text-primary" />
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Pipeline{feature.isNew && <NewBadge />}
        </h2>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setCreating((open) => !open)}>
          <PlusIcon className="size-3.5" />
          Kunde
        </Button>
      </header>
      {tracks.length > 1 && (
        <div role="tablist" aria-label="Release-Linie" className="flex flex-wrap gap-1">
          {tracks.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={entry === track}
              onClick={() => setChosen(entry)}
              className={cn(
                "h-7 rounded-md px-2.5 font-mono text-[11px] transition-colors",
                entry === track
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {entry}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <VersioningPipelineStages
          tip={pipeline.tip}
          committed={pipeline.committed}
          stages={pipeline.stages}
        />
        {pipeline.committed && pipeline.tip?.parent && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-[11px]"
            title={`${pipeline.tip.id} mit einem neuen Release auf ${pipeline.tip.parent} zurücknehmen`}
            onClick={() => {
              workspace.setRequestedRollbackId(pipeline.tip?.parent ?? "");
              onNavigate("releases");
            }}
          >
            <Undo2Icon className="size-3.5" />
            Zurücknehmen…
          </Button>
        )}
      </div>
      {next && (
        <div className="flex items-center gap-3 rounded-xl bg-primary/5 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">{next.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">{next.detail}</p>
          </div>
          <Button
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => (next.area === "customer" ? setCreating(true) : onNavigate(next.area))}
          >
            {next.action}
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </div>
      )}
      <VersioningRemoteBanner workspace={workspace} />
      {creating && (
        <VersioningCustomerCreate workspace={workspace} onDone={() => setCreating(false)} />
      )}
      {pipeline.rows.length > 0 ? (
        <div className="space-y-1.5">
          <div
            aria-hidden
            className="grid grid-cols-[minmax(6rem,1fr)_repeat(3,minmax(0,1.4fr))] gap-1.5 px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
          >
            <span>Kunde</span>
            {PIPELINE_STAGES.map((stage) => (
              <span key={stage}>{STAGE_LABELS[stage]}</span>
            ))}
          </div>
          {pipeline.rows.map((row) => {
            const tested = row.cells.test.some((entry) => entry.current);
            return (
              <section
                key={row.customer}
                aria-label={row.customer}
                className="grid grid-cols-[minmax(6rem,1fr)_repeat(3,minmax(0,1.4fr))] items-start gap-1.5 rounded-xl bg-muted/25 p-1.5"
              >
                <h3 className="truncate px-1 pt-1.5 text-xs font-semibold" title={row.customer}>
                  {row.customer}
                </h3>
                {PIPELINE_STAGES.map((stage) => (
                  <div key={stage} className="min-w-0">
                    <span className="sr-only">{STAGE_LABELS[stage]}</span>
                    <VersioningPipelineCell
                      entries={row.cells[stage]}
                      untested={stage === "production" && !tested}
                      onDeliver={deliver}
                    />
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        !creating && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {list.length
              ? `Keine Kunden auf der Linie ${track}.`
              : "Noch keine Kunden. Lege einen Kunden mit Test- und Produktivsystem an."}
          </p>
        )
      )}
      {(pendingTest.length > 0 || pendingProduction.length > 0) && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!pendingTest.length}
            onClick={() => deliver(pendingTest)}
          >
            Alle Testsysteme ({pendingTest.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!pendingProduction.length}
            onClick={() => deliver(pendingProduction)}
          >
            Alle Produktivsysteme ({pendingProduction.length})
          </Button>
        </div>
      )}
    </section>
  );
}
