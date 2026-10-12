import type { DatabaseDrift } from "./use-database-drift";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningAreaSwitch } from "./versioning-area-switch";
import { VersioningBranchBar } from "./versioning-branch-bar";
import { VersioningHeader } from "./versioning-header";
import { VersioningWorkingCopy } from "./versioning-working-copy";

export function VersioningToolbar({
  workspace,
  drift,
  area,
  onArea,
  count,
}: {
  workspace: VersioningWorkspace;
  drift: DatabaseDrift;
  area: "database" | "git";
  onArea: (area: "database" | "git") => void;
  count: number;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1 border-b border-border/60 py-1.5 pr-1 pl-3">
      <span
        className="mr-1 max-w-40 truncate text-xs font-semibold"
        title={workspace.project?.name}
      >
        {workspace.project?.name}
      </span>
      <span aria-hidden className="text-border">
        /
      </span>
      <VersioningBranchBar workspace={workspace} />
      <span aria-hidden className="text-border">
        /
      </span>
      <VersioningWorkingCopy workspace={workspace} drift={drift} />
      <span className="flex-1" />
      <VersioningAreaSwitch
        area={area}
        onChange={onArea}
        count={count}
        className="w-auto px-0 pb-0"
      />
      <VersioningHeader workspace={workspace} area={area} compact className="h-8 px-1" />
    </div>
  );
}
