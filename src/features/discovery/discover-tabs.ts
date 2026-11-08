import { LayoutGrid, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export interface DiscoverTab {
  id: string;
  label: string;
  icon: LucideIcon;
  load: () => Promise<{ default: ComponentType }>;
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
];
