import { CircleAlertIcon, GitCompareArrowsIcon } from "lucide-react";
import { useHasNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";
import { changeSummary } from "@/lib/versioning/changes";
import { deployable } from "@/lib/versioning/model";
import type { VersioningArea } from "@/lib/versioning/workflow";
import type { DatabaseDrift } from "./use-database-drift";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningChanges } from "./versioning-changes";
import { VersioningDriftDiff } from "./versioning-drift-diff";
import { VersioningFileDiff } from "./versioning-file-diff";
import { VersioningNav } from "./versioning-nav";
import { VersioningSection } from "./versioning-section";
import { VERSIONING_SECTIONS } from "./versioning-sections";
import { VersioningToolbar } from "./versioning-toolbar";

export function VersioningWorkbench({
  workspace,
  development,
  drift,
  section: requested,
  onNavigate,
  area,
  onArea,
  compact = false,
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  drift: DatabaseDrift;
  section: VersioningArea;
  onNavigate: (area: VersioningArea) => void;
  area: "database" | "git";
  onArea: (area: "database" | "git") => void;
  compact?: boolean;
}) {
  const { project, busy, error, message } = workspace;
  const reviewsNew = useHasNewFeatures("versioning.reviews");
  const pipelineNew = useHasNewFeatures("versioning.pipeline");
  if (!project) return null;
  const deploys = deployable(project.kind);
  const section =
    deploys || !VERSIONING_SECTIONS.some((entry) => entry.id === requested && entry.deploy)
      ? requested
      : "development";
  const pending = changeSummary(drift.entries, development.changes, [], []).total;
  const changesView = section === "development";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <VersioningToolbar
        workspace={workspace}
        drift={drift}
        area={area}
        onArea={onArea}
        count={development.changes.size}
      />
      <VersioningNav
        section={section}
        deploys={deploys}
        disabled={busy}
        onNavigate={onNavigate}
        fresh={{ reviews: reviewsNew, pipeline: pipelineNew }}
        counts={{
          development: pending,
          releases: workspace.releases.at(-1)?.id,
          targets: workspace.targets?.targets.length,
        }}
      />
      {error && (
        <div
          role="alert"
          className="mx-4 mt-3 flex shrink-0 gap-2 rounded-lg bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error.replace(/^Error: /, "")}</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {changesView && (
          <aside
            aria-label="Änderungen"
            className={cn(
              "flex shrink-0 flex-col border-r border-border/60",
              compact ? "w-56" : "w-80",
            )}
          >
            <VersioningChanges workspace={workspace} development={development} drift={drift} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {changesView && development.path ? (
            <fieldset disabled={busy} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <VersioningFileDiff workspace={workspace} development={development} fill />
            </fieldset>
          ) : changesView && drift.focus ? (
            <VersioningDriftDiff workspace={workspace} drift={drift} />
          ) : changesView ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
              <GitCompareArrowsIcon className="size-7 text-muted-foreground/40" strokeWidth={1.4} />
              <p className="text-xs font-medium">
                {pending ? "Änderung auswählen, um den Unterschied zu sehen" : "Alles committet"}
              </p>
              <p className="max-w-72 text-[11px] leading-relaxed text-muted-foreground">
                {pending
                  ? "Angehakte Änderungen aus Datenbank und Dateien landen gemeinsam im nächsten Commit."
                  : "Ändere Objekte in der Arbeitskopie. Sie erscheinen hier, sobald die Datenbank geprüft wurde."}
              </p>
            </div>
          ) : (
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain",
                section === "history" ? "flex flex-col" : "px-5 pt-4 pb-5",
              )}
            >
              <fieldset
                disabled={busy}
                className={cn("min-w-0", section === "history" && "flex min-h-0 flex-1 flex-col")}
              >
                <VersioningSection
                  section={section}
                  workspace={workspace}
                  onNavigate={onNavigate}
                />
              </fieldset>
            </div>
          )}
          {message && (
            <p
              role="status"
              className="shrink-0 truncate border-t border-border/60 px-4 py-1.5 text-[10px] text-muted-foreground"
              title={message}
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
