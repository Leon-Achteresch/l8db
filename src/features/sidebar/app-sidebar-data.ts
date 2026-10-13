import {
  ActivityIcon,
  BlocksIcon,
  DiffIcon,
  GitCompareArrows,
  HeartPulseIcon,
  Home,
  LayoutDashboard,
  ListTreeIcon,
  type LucideIcon,
  NotebookPenIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  WaypointsIcon,
  ZapIcon,
} from "lucide-react";

import type { Capabilities } from "@/lib/db";
import type { FileRouteTypes } from "@/routeTree.gen";

export type AppSidebarNavItem = {
  title: string;
  url: FileRouteTypes["to"];
  icon: LucideIcon;
  available?: (caps: Capabilities) => boolean;
  featureScope?: string;
  connectionFree?: boolean;
};

export const appSidebarData: { navMain: AppSidebarNavItem[] } = {
  navMain: [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, featureScope: "dashboard" },
    { title: "Übersicht", url: "/", icon: Home, available: (caps) => caps.overview },
    { title: "SQL-Arbeitsplatz", url: "/query", icon: SquareTerminalIcon },
    {
      title: "SQL-Notebooks",
      url: "/notebook",
      icon: NotebookPenIcon,
      available: (caps) => caps.query_language === "sql",
    },
    {
      title: "Invalid Objects",
      url: "/invalid-objects",
      icon: TriangleAlertIcon,
      available: (caps) => caps.compile_objects,
    },
    { title: "Monitor", url: "/monitor", icon: ActivityIcon },
    {
      title: "Health",
      url: "/health",
      icon: HeartPulseIcon,
      featureScope: "health",
      available: (caps) => caps.health_advisor,
    },
    {
      title: "Query Builder",
      url: "/query-builder",
      icon: BlocksIcon,
      available: (caps) => caps.query_language === "sql",
    },
    {
      title: "ER-Diagramm",
      url: "/er-diagram",
      icon: WaypointsIcon,
      featureScope: "er-diagram",
      available: (caps) => caps.foreign_keys,
    },
    { title: "Vergleich", url: "/compare", icon: DiffIcon, featureScope: "compare" },
    {
      title: "Schema-Vergleich",
      url: "/schema-compare",
      icon: GitCompareArrows,
      available: (caps) => caps.schema_object_copy,
    },
    {
      title: "Gespeicherte Pläne",
      url: "/saved-plan",
      icon: ListTreeIcon,
      available: (caps) => caps.explain,
    },
    {
      title: "Automatisierung",
      url: "/automation",
      icon: ZapIcon,
      featureScope: "automation",
      connectionFree: true,
    },
  ],
};
