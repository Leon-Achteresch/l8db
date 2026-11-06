import {
  Activity,
  Blocks,
  CalendarClock,
  ChartSpline,
  Cloud,
  CloudCog,
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
  Users,
  UsersRound,
  Waypoints,
  Workflow,
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
  group?: number;
};

export const navGroupLabels = ["Verbindung", "Arbeiten", "Diagnose", "Werkzeuge"];

export const appSidebarData: { navMain: AppSidebarNavItem[] } = {
  navMain: [
    {
      title: "Cloud-Konten",
      url: "/cloud-accounts",
      icon: Cloud,
      activeIcon: CloudCog,
      featureScope: "connections.cloud-accounts",
      connectionFree: true,
    },
    {
      title: "Team-Workspaces",
      url: "/workspaces",
      icon: Users,
      activeIcon: UsersRound,
      featureScope: "connections.workspaces",
      connectionFree: true,
    },
    {
      title: "Föderiertes SQL",
      url: "/federation",
      icon: Network,
      activeIcon: Workflow,
      featureScope: "query.federation",
      connectionFree: true,
    },
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      activeIcon: LayoutGrid,
      featureScope: "dashboard",
    },
    {
      title: "Start",
      url: "/",
      icon: House,
      activeIcon: HousePlug,
      available: (caps) => caps.overview,
    },
    {
      title: "SQL-Arbeitsplatz",
      url: "/query",
      icon: SquareTerminal,
      activeIcon: Terminal,
      group: 1,
    },
    {
      title: "SQL-Notebooks",
      url: "/notebook",
      group: 1,
      icon: NotebookPen,
      activeIcon: NotebookText,
      available: (caps) => caps.query_language === "sql",
    },
    {
      title: "Ungültige Objekte",
      url: "/invalid-objects",
      group: 2,
      icon: TriangleAlert,
      activeIcon: OctagonAlert,
      available: (caps) => caps.compile_objects,
    },
    { title: "Monitor", url: "/monitor", icon: Activity, activeIcon: ChartSpline, group: 2 },
    {
      title: "Zustand",
      url: "/health",
      group: 2,
      icon: HeartPulse,
      activeIcon: HeartPlus,
      featureScope: "health",
      available: (caps) => caps.health_advisor,
    },
    {
      title: "Abfrage-Builder",
      url: "/query-builder",
      group: 1,
      icon: Blocks,
      activeIcon: Grid2x2Plus,
      available: (caps) => caps.query_language === "sql",
    },
    {
      title: "ER-Diagramm",
      url: "/er-diagram",
      group: 1,
      icon: Waypoints,
      activeIcon: Network,
      featureScope: "er-diagram",
      available: (caps) => caps.foreign_keys,
    },
    {
      title: "Vergleich",
      url: "/compare",
      group: 3,
      icon: Diff,
      activeIcon: FileDiff,
      featureScope: "compare",
    },
    {
      title: "Schema-Vergleich",
      url: "/schema-compare",
      group: 3,
      icon: GitCompareArrows,
      activeIcon: GitCompare,
      featureScope: "schema-compare",
      available: (caps) => caps.schema_object_copy,
    },
    {
      title: "Gespeicherte Pläne",
      url: "/saved-plan",
      group: 2,
      icon: ListTree,
      activeIcon: ListChecks,
      available: (caps) => caps.explain,
    },
    {
      title: "Automatisierung",
      url: "/automation",
      group: 3,
      icon: Zap,
      activeIcon: CalendarClock,
      featureScope: "automation",
      connectionFree: true,
    },
  ],
};
