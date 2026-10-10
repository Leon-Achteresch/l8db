import type { VersioningArea } from "@/lib/versioning/workflow";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningActivity } from "./versioning-activity";
import { VersioningBranches } from "./versioning-branches";
import { VersioningHistoryPanel } from "./versioning-history-panel";
import { VersioningPipeline } from "./versioning-pipeline";
import { VersioningReleases } from "./versioning-releases";
import { VersioningReviews } from "./versioning-reviews";
import { VersioningSeeds } from "./versioning-seeds";
import { VersioningTargets } from "./versioning-targets";

export function VersioningSection({
  section,
  workspace,
  onNavigate,
}: {
  section: VersioningArea;
  workspace: VersioningWorkspace;
  onNavigate: (area: VersioningArea) => void;
}) {
  const { status, project } = workspace;
  if (!status || !project) return null;
  const branchKey = `${status.repo}:${project.id}:${status.branch}`;
  const projectKey = `${status.repo}:${project.id}`;
  switch (section) {
    case "pipeline":
      return <VersioningPipeline workspace={workspace} onNavigate={onNavigate} />;
    case "branches":
      return <VersioningBranches workspace={workspace} />;
    case "seeds":
      return <VersioningSeeds key={branchKey} workspace={workspace} />;
    case "development":
      return null;
    case "history":
      return <VersioningHistoryPanel workspace={workspace} onNavigate={onNavigate} />;
    case "releases":
      return (
        <VersioningReleases
          key={branchKey}
          workspace={workspace}
          onRollout={(id) => {
            workspace.setRequestedReleaseId(id);
            onNavigate("targets");
          }}
        />
      );
    case "reviews":
      return <VersioningReviews key={projectKey} workspace={workspace} />;
    case "targets":
      return <VersioningTargets key={projectKey} workspace={workspace} />;
    case "activity":
      return <VersioningActivity workspace={workspace} />;
  }
}
