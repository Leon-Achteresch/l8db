import { CircleAlertIcon, PanelBottomIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { useHasNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";
import { deployable } from "@/lib/versioning/model";
import type { VersioningArea } from "@/lib/versioning/workflow";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningAreaSwitch } from "./versioning-area-switch";
import { VersioningBranchBar } from "./versioning-branch-bar";
import { VersioningChangeList } from "./versioning-change-list";
import { VersioningChangeListHeader } from "./versioning-change-list-header";
import { VersioningCommitBox } from "./versioning-commit-box";
import { VersioningDatabaseChanges } from "./versioning-database-changes";
import { VersioningFileDiff } from "./versioning-file-diff";
import { VersioningHeader } from "./versioning-header";
import { VersioningHistoryPanel } from "./versioning-history-panel";
import { VersioningSection } from "./versioning-section";
import { VERSIONING_SECTIONS } from "./versioning-sections";

const HISTORY_KEY = "l8db.versioning.history";

export function VersioningWorkbench({
  workspace,
  development,
  section,
  onNavigate,
  area,
  onArea,
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  section: VersioningArea;
  onNavigate: (area: VersioningArea) => void;
  area: "database" | "git";
  onArea: (area: "database" | "git") => void;
}) {
  const { project, busy, error, message } = workspace;
  const [changesOpen, setChangesOpen] = useState(true);
  const [history, setHistory] = useState(() => localStorage.getItem(HISTORY_KEY) !== "hidden");
  const reviewsNew = useHasNewFeatures("versioning.reviews");
  const deliveryNew = useHasNewFeatures("versioning.delivery");
  if (!project) return null;
  const fresh: Partial<Record<VersioningArea, boolean>> = {
    reviews: reviewsNew,
    delivery: deliveryNew,
  };
  const toggleHistory = (next: boolean) => {
    localStorage.setItem(HISTORY_KEY, next ? "visible" : "hidden");
    setHistory(next);
  };
  const deploys = deployable(project.kind);
  const diff = section === "development" && Boolean(development.path);
  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Versionierung"
        className="flex w-72 shrink-0 flex-col border-r border-border/60"
      >
        <VersioningHeader workspace={workspace} area={area} className="pr-2 pl-3" />
        <VersioningAreaSwitch
          area={area}
          onChange={onArea}
          count={development.changes.size}
          className="px-3"
        />
        <VersioningBranchBar workspace={workspace} label={project.name} className="px-1.5 pb-2" />
        <div className="shrink-0 px-3 pb-3">
          <VersioningCommitBox workspace={workspace} development={development} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3">
          <VersioningChangeListHeader
            workspace={workspace}
            development={development}
            open={changesOpen}
            onToggle={() => setChangesOpen(!changesOpen)}
          />
          {changesOpen && (
            <VersioningChangeList
              workspace={workspace}
              development={development}
              onOpen={() => onNavigate("development")}
            />
          )}
          <nav className="mt-3 flex flex-col">
            <span id="vcs-sections" className="flex h-8 items-center pl-1 text-xs font-semibold">
              Bereiche
            </span>
            <div
              role="tablist"
              aria-orientation="vertical"
              aria-labelledby="vcs-sections"
              className="flex flex-col"
            >
              {VERSIONING_SECTIONS.filter((entry) => deploys || !entry.deploy).map(
                ({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    role="tab"
                    aria-selected={section === id}
                    onClick={() => onNavigate(id)}
                    className={cn(
                      "flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors disabled:opacity-50",
                      section === id
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {fresh[id] && section !== id && <NewBadge />}
                    {id === "development" && development.changes.size > 0 && (
                      <span className="text-[11px] tabular-nums">{development.changes.size}</span>
                    )}
                    {id === "releases" && workspace.releases.length > 0 && (
                      <span className="font-mono text-[11px]">{workspace.releases.at(-1)?.id}</span>
                    )}
                    {id === "targets" && Boolean(workspace.targets?.targets.length) && (
                      <span className="text-[11px] tabular-nums">
                        {workspace.targets?.targets.length}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
            {!history && (
              <button
                type="button"
                onClick={() => toggleHistory(true)}
                className="mt-1 flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                <PanelBottomIcon className="size-3.5 shrink-0" />
                Verlauf einblenden
              </button>
            )}
          </nav>
        </div>
        {message && (
          <p
            role="status"
            className="shrink-0 truncate border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground"
            title={message}
          >
            {message}
          </p>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div
            role="alert"
            className="mx-4 mt-3 flex shrink-0 gap-2 rounded-lg bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
          >
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{error.replace(/^Error: /, "")}</span>
          </div>
        )}
        {diff ? (
          <fieldset disabled={busy} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <VersioningFileDiff workspace={workspace} development={development} fill />
          </fieldset>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-5">
            <fieldset disabled={busy} className="min-w-0">
              {section === "development" ? (
                <VersioningDatabaseChanges workspace={workspace} />
              ) : (
                <VersioningSection
                  section={section}
                  workspace={workspace}
                  development={development}
                  onNavigate={onNavigate}
                />
              )}
            </fieldset>
          </div>
        )}
        {history && (
          <VersioningHistoryPanel
            workspace={workspace}
            onNavigate={onNavigate}
            onClose={() => toggleHistory(false)}
          />
        )}
      </div>
    </div>
  );
}
