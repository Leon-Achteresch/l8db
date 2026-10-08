import {
  FileDiffIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  RocketIcon,
  ServerIcon,
  SproutIcon,
  TagIcon,
} from "lucide-react";
import type { VersioningArea } from "@/lib/versioning/workflow";

export const VERSIONING_SECTIONS: {
  id: VersioningArea;
  label: string;
  icon: LucideIcon;
  deploy?: boolean;
}[] = [
  { id: "overview", label: "Übersicht", icon: LayoutDashboardIcon },
  { id: "branches", label: "Branches", icon: GitBranchIcon },
  { id: "development", label: "Änderungen", icon: FileDiffIcon },
  { id: "reviews", label: "Reviews", icon: GitPullRequestIcon },
  { id: "releases", label: "Releases", icon: TagIcon, deploy: true },
  { id: "delivery", label: "Auslieferung", icon: RocketIcon, deploy: true },
  { id: "targets", label: "Kunden", icon: ServerIcon, deploy: true },
  { id: "seeds", label: "Seeds", icon: SproutIcon, deploy: true },
  { id: "activity", label: "Aktivität", icon: HistoryIcon },
];
