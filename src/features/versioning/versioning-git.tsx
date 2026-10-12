import type { VersioningArea } from "@/lib/versioning/workflow";
import { useDatabaseDrift } from "./use-database-drift";
import { useDevelopment } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningWorkbench } from "./versioning-workbench";

export function VersioningGit({
  workspace,
  wide,
  section,
  onNavigate,
  area,
  onArea,
}: {
  workspace: VersioningWorkspace;
  wide: boolean;
  section: VersioningArea;
  onNavigate: (area: VersioningArea) => void;
  area: "database" | "git";
  onArea: (area: "database" | "git") => void;
}) {
  const development = useDevelopment(workspace);
  const drift = useDatabaseDrift(workspace);
  if (!workspace.status || !workspace.project) return null;
  return (
    <VersioningWorkbench
      workspace={workspace}
      development={development}
      drift={drift}
      section={section}
      onNavigate={onNavigate}
      area={area}
      onArea={onArea}
      compact={!wide}
    />
  );
}
