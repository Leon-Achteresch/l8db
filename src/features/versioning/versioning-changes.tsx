import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { relativeTime } from "@/lib/branching/model";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { changeSummary } from "@/lib/versioning/changes";
import type { DatabaseDrift } from "./use-database-drift";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningChangeList } from "./versioning-change-list";
import { VersioningCommitBox } from "./versioning-commit-box";
import { VersioningDriftList } from "./versioning-drift-list";
import { VersioningIconButton } from "./versioning-icon-button";

export function VersioningChanges({
  workspace,
  development,
  drift,
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  drift: DatabaseDrift;
}) {
  const { run } = workspace;
  const { changes, selected, setSelected } = development;
  const feature = useNewFeatureVisibility<HTMLDivElement>("versioning.working-copy");
  const summary = changeSummary(drift.entries, changes, selected, drift.selected);
  const { shadowed, total } = summary;
  const openDrift = (id: string) =>
    void run(async () => {
      if (development.path) development.close();
      drift.setFocus(id);
    });
  return (
    <div ref={feature.ref} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 pr-1.5 pl-2.5 text-xs">
        <input
          type="checkbox"
          aria-label="Alle Änderungen auswählen"
          title="Alle Änderungen auswählen"
          className="size-3.5"
          disabled={!total}
          checked={total > 0 && summary.selected === total}
          onChange={(event) => {
            drift.setSelected(
              event.target.checked ? (drift.entries ?? []).map((entry) => entry.object.id) : [],
            );
            setSelected(event.target.checked ? summary.selectableFiles : []);
          }}
        />
        <span className="min-w-0 flex-1 truncate font-semibold">
          {total ? `${total} ${total === 1 ? "Änderung" : "Änderungen"}` : "Keine Änderungen"}
          {feature.isNew && <NewBadge />}
        </span>
        {drift.scanning && (
          <LoaderCircleIcon
            aria-label="Datenbank wird geprüft"
            className="size-3.5 shrink-0 animate-spin text-muted-foreground"
          />
        )}
        <button
          type="button"
          aria-pressed={development.showAll}
          aria-label="Alle Dateien"
          title={development.showAll ? "Nur Änderungen zeigen" : "Alle Dateien zeigen"}
          onClick={() => development.setShowAll(!development.showAll)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] transition-colors",
            development.showAll
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Alle
        </button>
        <VersioningIconButton
          icon={RefreshCwIcon}
          label={
            drift.scannedAt
              ? `Datenbank erneut prüfen (zuletzt ${relativeTime(new Date(drift.scannedAt).toISOString())})`
              : "Datenbank prüfen"
          }
          className="size-7"
          disabled={!drift.ready || drift.scanning || workspace.busy}
          onClick={drift.scan}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
        {!drift.ready && (
          <p className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Oben eine Entwicklungsdatenbank als Arbeitskopie wählen, damit ihre Änderungen hier
            erscheinen.
          </p>
        )}
        {drift.error && (
          <p className="px-2 py-2 text-[11px] leading-relaxed text-destructive">{drift.error}</p>
        )}
        <VersioningDriftList drift={drift} onOpen={openDrift} />
        {(development.showAll || summary.files > 0 || !summary.database) && (
          <VersioningChangeList
            workspace={workspace}
            development={development}
            hidden={shadowed}
            onOpen={() => drift.setFocus(null)}
          />
        )}
      </div>
      <div className="shrink-0 border-t border-border/60 p-2.5">
        <VersioningCommitBox
          workspace={workspace}
          development={development}
          pending={drift.selected.length}
          prepare={() => drift.take(drift.selected)}
          exclude={shadowed}
        />
      </div>
    </div>
  );
}
