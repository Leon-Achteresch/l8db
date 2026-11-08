import type { ComponentType } from "react";

export interface DiscoveryHostEntry {
  id: string;
  load: () => Promise<{ default: ComponentType }>;
}

export const DISCOVERY_HOSTS: DiscoveryHostEntry[] = [
  {
    id: "spotlight",
    load: () =>
      import("@/features/discovery/spotlight/spotlight-host").then(({ SpotlightHost }) => ({
        default: SpotlightHost,
      })),
  },
  {
    id: "hotspots",
    load: () =>
      import("@/features/discovery/hotspots/hotspot-host").then(({ HotspotHost }) => ({
        default: HotspotHost,
      })),
  },
  {
    id: "video-tooltips",
    load: () =>
      import("@/features/discovery/video-tooltips/video-tooltip-host").then(
        ({ VideoTooltipHost }) => ({ default: VideoTooltipHost }),
      ),
  },
  { id: "promoter", load: () => import("@/features/discovery/promoter/promoter-host") },
  { id: "wait-tips", load: () => import("@/features/discovery/wait-tips/wait-tips-host") },
  { id: "feedback", load: () => import("@/features/discovery/feedback/feedback-host") },
  { id: "related", load: () => import("@/features/discovery/related/related-host") },
  {
    id: "modifier-overlay",
    load: () =>
      import("@/features/discovery/modifier-overlay/modifier-overlay-host").then(
        ({ ModifierOverlayHost }) => ({ default: ModifierOverlayHost }),
      ),
  },
  {
    id: "cheatsheet",
    load: () =>
      import("@/features/discovery/cheatsheet/cheatsheet-host").then(({ CheatsheetHost }) => ({
        default: CheatsheetHost,
      })),
  },
  {
    id: "guide",
    load: () =>
      import("@/features/discovery/guide/guide-host").then(({ GuideHost }) => ({
        default: GuideHost,
      })),
  },
  {
    id: "lessons",
    load: () =>
      import("@/features/discovery/lessons/lesson-host").then(({ LessonHost }) => ({
        default: LessonHost,
      })),
  },
  {
    id: "whats-this",
    load: () =>
      import("@/features/discovery/whats-this/whats-this-host").then(({ WhatsThisHost }) => ({
        default: WhatsThisHost,
      })),
  },
  {
    id: "team-tips",
    load: () =>
      import("@/features/discovery/team-tips/team-tips-host").then(({ TeamTipsHost }) => ({
        default: TeamTipsHost,
      })),
  },
  {
    id: "recap",
    load: () =>
      import("@/features/discovery/recap/recap-host").then(({ RecapHost }) => ({
        default: RecapHost,
      })),
  },
  {
    id: "achievements",
    load: () =>
      import("@/features/discovery/achievements/achievements-host").then(
        ({ AchievementsHost }) => ({ default: AchievementsHost }),
      ),
  },
];
