import {
  FileDiffIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HistoryIcon,
  type LucideIcon,
  ServerIcon,
  SproutIcon,
  TagIcon,
  WorkflowIcon,
} from "lucide-react";
import type { VersioningArea } from "@/lib/versioning/workflow";

export const VERSIONING_SECTIONS: {
  id: VersioningArea;
  label: string;
  icon: LucideIcon;
  deploy?: boolean;
  tool?: boolean;
}[] = [
  { id: "pipeline", label: "Pipeline", icon: WorkflowIcon, deploy: true },
  { id: "development", label: "Änderungen", icon: FileDiffIcon },
  { id: "releases", label: "Releases", icon: TagIcon, deploy: true },
  { id: "reviews", label: "Reviews", icon: GitPullRequestIcon },
  { id: "targets", label: "Kunden", icon: ServerIcon, deploy: true },
  { id: "branches", label: "Branches", icon: GitBranchIcon, tool: true },
  { id: "seeds", label: "Seeds", icon: SproutIcon, deploy: true, tool: true },
  { id: "activity", label: "Aktivität", icon: HistoryIcon, tool: true },
];
