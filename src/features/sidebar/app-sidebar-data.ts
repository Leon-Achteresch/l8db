import {
  Activity,
  Blocks,
  CalendarClock,
  ChartSpline,
  Diff,
  FileDiff,
  GitCompare,
  GitCompareArrows,
  Grid2x2Plus,
  HeartPlus,
  HeartPulse,
  House,
  HousePlug,
  type IconNode,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  ListTree,
  Network,
  NotebookPen,
  NotebookText,
  OctagonAlert,
  SquareTerminal,
  Terminal,
  TriangleAlert,
  Waypoints,
  Zap,
} from "lucide";

import type { Capabilities } from "@/lib/db";
import type { FileRouteTypes } from "@/routeTree.gen";

export type AppSidebarNavItem = {
  title: string;
  url: FileRouteTypes["to"];
  icon: IconNode;
  activeIcon: IconNode;
  available?: (caps: Capabilities) => boolean;
  featureScope?: string;
  connectionFree?: boolean;
};

export const appSidebarData: { navMain: AppSidebarNavItem[] } = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      activeIcon: LayoutGrid,
      featureScope: "dashboard",
    },
    {
      title: "Übersicht",
      url: "/",
      icon: House,
      activeIcon: HousePlug,
      available: (caps) => caps.overview,
    },
    { title: "SQL-Arbeitsplatz", url: "/query", icon: SquareTerminal, activeIcon: Terminal },
    {
      title: "SQL-Notebooks",
      url: "/notebook",
      icon: NotebookPen,
      activeIcon: NotebookText,
      available: (caps) => caps.query_language === "sql",
    },
    {
      title: "Invalid Objects",
      url: "/invalid-objects",
      icon: TriangleAlert,
      activeIcon: OctagonAlert,
      available: (caps) => caps.compile_objects,
    },
    { title: "Monitor", url: "/monitor", icon: Activity, activeIcon: ChartSpline },
    {
      title: "Health",
      url: "/health",
      icon: HeartPulse,
      activeIcon: HeartPlus,
      featureScope: "health",
      available: (caps) => caps.health_advisor,
    },
    {
      title: "Query Builder",
      url: "/query-builder",
      icon: Blocks,
      activeIcon: Grid2x2Plus,
      available: (caps) => caps.query_language === "sql",
    },
    {
      title: "ER-Diagramm",
      url: "/er-diagram",
      icon: Waypoints,
      activeIcon: Network,
      featureScope: "er-diagram",
      available: (caps) => caps.foreign_keys,
    },
    {
      title: "Vergleich",
      url: "/compare",
      icon: Diff,
      activeIcon: FileDiff,
      featureScope: "compare",
    },
    {
      title: "Schema-Vergleich",
      url: "/schema-compare",
      icon: GitCompareArrows,
      activeIcon: GitCompare,
      featureScope: "schema-compare",
      available: (caps) => caps.schema_object_copy,
    },
    {
      title: "Gespeicherte Pläne",
      url: "/saved-plan",
      icon: ListTree,
      activeIcon: ListChecks,
      available: (caps) => caps.explain,
    },
    {
      title: "Automatisierung",
      url: "/automation",
      icon: Zap,
      activeIcon: CalendarClock,
      featureScope: "automation",
      connectionFree: true,
    },
  ],
};
