import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningChangeList } from "./versioning-change-list";
import { VersioningChangeListHeader } from "./versioning-change-list-header";
import { VersioningCommitBox } from "./versioning-commit-box";
import { VersioningDatabaseChanges } from "./versioning-database-changes";
import { VersioningFileDiff } from "./versioning-file-diff";

export function VersioningDevelopment({
  workspace,
  development,
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
}) {
  if (!workspace.project || !workspace.status) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <VersioningDatabaseChanges workspace={workspace} />
      <div className="flex flex-col gap-3 border-t border-border/50 pt-4">
        <VersioningCommitBox workspace={workspace} development={development} />
        <div>
          <VersioningChangeListHeader workspace={workspace} development={development} />
          <div className="max-h-72 overflow-y-auto">
            <VersioningChangeList workspace={workspace} development={development} />
          </div>
        </div>
      </div>
      <VersioningFileDiff workspace={workspace} development={development} />
    </div>
  );
}
