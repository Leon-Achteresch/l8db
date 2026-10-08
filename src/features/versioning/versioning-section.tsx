import type { VersioningArea } from "@/lib/versioning/workflow";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningActivity } from "./versioning-activity";
import { VersioningBranches } from "./versioning-branches";
import { VersioningDelivery } from "./versioning-delivery";
import { VersioningDevelopment } from "./versioning-development";
import { VersioningOverview } from "./versioning-overview";
import { VersioningReleases } from "./versioning-releases";
import { VersioningReviews } from "./versioning-reviews";
import { VersioningSeeds } from "./versioning-seeds";
import { VersioningTargets } from "./versioning-targets";

export function VersioningSection({
  section,
  workspace,
  development,
  onNavigate,
}: {
  section: VersioningArea;
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  onNavigate: (area: VersioningArea) => void;
}) {
  const { status, project } = workspace;
  if (!status || !project) return null;
  const branchKey = `${status.repo}:${project.id}:${status.branch}`;
  const projectKey = `${status.repo}:${project.id}`;
  switch (section) {
    case "overview":
      return <VersioningOverview workspace={workspace} onNavigate={onNavigate} />;
    case "branches":
      return <VersioningBranches workspace={workspace} />;
    case "seeds":
      return <VersioningSeeds key={branchKey} workspace={workspace} />;
    case "development":
      return <VersioningDevelopment workspace={workspace} development={development} />;
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
    case "delivery":
      return <VersioningDelivery workspace={workspace} onNavigate={onNavigate} />;
    case "targets":
      return <VersioningTargets key={projectKey} workspace={workspace} />;
    case "activity":
      return <VersioningActivity workspace={workspace} />;
  }
}
