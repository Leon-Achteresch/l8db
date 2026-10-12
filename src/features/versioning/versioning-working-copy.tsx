import { ChevronDownIcon, DatabaseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompareSidePicker } from "@/features/compare/compare-side-picker";
import { cn } from "@/lib/utils";
import type { DatabaseDrift } from "./use-database-drift";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPopover } from "./versioning-popover";

export function VersioningWorkingCopy({
  workspace,
  drift,
}: {
  workspace: VersioningWorkspace;
  drift: DatabaseDrift;
}) {
  const { project, run, busy } = workspace;
  if (!project) return null;
  const label = drift.mismatch
    ? `${drift.connection?.name} passt nicht`
    : drift.scope || "Datenbank verknüpfen";
  return (
    <VersioningPopover
      icon={DatabaseIcon}
      label="Arbeitskopie"
      disabled={busy}
      trigger={
        <button
          type="button"
          disabled={busy}
          aria-label={`Arbeitskopie: ${label}`}
          title="Entwicklungsdatenbank, deren Stand du committest"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-muted"
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              drift.ready ? "bg-emerald-500" : "bg-amber-500",
            )}
          />
          <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !drift.ready && "text-muted-foreground")}>{label}</span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>
      }
    >
      <CompareSidePicker
        title="Arbeitskopie"
        value={drift.source}
        onChange={drift.setSource}
        schemaOnly
        className="border-0 bg-transparent p-0"
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Änderungen in dieser Entwicklungsdatenbank erscheinen unter Änderungen und werden mit dem
        Commit ins Repository übernommen. Die Zuordnung lässt sich pro Branch in Git teilen;
        Zugangsdaten bleiben auf diesem Rechner.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={!drift.ready}
        onClick={() =>
          void run(
            () => workspace.setDevelopmentSource(drift.source),
            "Arbeitskopie für diesen Branch in Git gespeichert",
          )
        }
      >
        Für diesen Branch in Git teilen
      </Button>
    </VersioningPopover>
  );
}
