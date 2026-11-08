import {
  CalendarHeart,
  GraduationCap,
  LayoutGrid,
  type LucideIcon,
  Map as MapIcon,
  Milestone,
  Trophy,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import { useTeamStore } from "@/lib/team/store";

export interface DiscoverTab {
  id: string;
  label: string;
  icon: LucideIcon;
  load: () => Promise<{ default: ComponentType }>;
  visible?: () => boolean;
}

export const DISCOVER_TABS: DiscoverTab[] = [
  {
    id: "overview",
    label: "Übersicht",
    icon: LayoutGrid,
    load: () =>
      import("@/features/discovery/discover-overview-tab").then(({ DiscoverOverviewTab }) => ({
        default: DiscoverOverviewTab,
      })),
  },
  {
    id: "atlas",
    label: "Atlas",
    icon: MapIcon,
    load: () =>
      import("@/features/discovery/atlas/atlas-tab").then(({ AtlasTab }) => ({
        default: AtlasTab,
      })),
  },
  {
    id: "lessons",
    label: "Lektionen",
    icon: GraduationCap,
    load: () =>
      import("@/features/discovery/lessons/lessons-tab").then(({ LessonsTab }) => ({
        default: LessonsTab,
      })),
  },
  {
    id: "roadmap",
    label: "Roadmap",
    icon: Milestone,
    load: () =>
      import("@/features/discovery/roadmap/discover-roadmap-tab").then(
        ({ DiscoverRoadmapTab }) => ({ default: DiscoverRoadmapTab }),
      ),
  },
  {
    id: "recap",
    label: "Rückblick",
    icon: CalendarHeart,
    load: () =>
      import("@/features/discovery/recap/discover-recap-tab").then(({ DiscoverRecapTab }) => ({
        default: DiscoverRecapTab,
      })),
  },
  {
    id: "achievements",
    label: "Erfolge",
    icon: Trophy,
    load: () =>
      import("@/features/discovery/achievements/discover-achievements-tab").then(
        ({ DiscoverAchievementsTab }) => ({ default: DiscoverAchievementsTab }),
      ),
  },
  {
    id: "team",
    label: "Team",
    icon: Users,
    visible: () => useTeamStore.getState().exists,
    load: () =>
      import("@/features/discovery/team-tips/discover-team-tab").then(({ DiscoverTeamTab }) => ({
        default: DiscoverTeamTab,
      })),
  },
];
