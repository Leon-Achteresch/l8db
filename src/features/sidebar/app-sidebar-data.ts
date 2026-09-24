import {
  GaugeIcon,
  GitCompare,
  GitCompareArrows,
  HammerIcon,
  Home,
  LayoutDashboard,
  type LucideIcon,
  Network,
  Route as RouteIcon,
  SquareTerminalIcon,
  Table2,
} from "lucide-react";

import type { Capabilities } from "@/lib/db";
import type { FileRouteTypes } from "@/routeTree.gen";

export type AppSidebarNavItem = {
  title: string;
  url: FileRouteTypes["to"];
  icon: LucideIcon;
  available?: (caps: Capabilities) => boolean;
};

export const appSidebarData: { navMain: AppSidebarNavItem[] } = {
  navMain: [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Übersicht", url: "/", icon: Home, available: (caps) => caps.overview },
    { title: "SQL-Arbeitsplatz", url: "/query", icon: SquareTerminalIcon },
    {
      title: "Invalid Objects",
      url: "/invalid-objects",
      icon: HammerIcon,
      available: (caps) => caps.compile_objects,
    },
    { title: "Monitor", url: "/monitor", icon: GaugeIcon },
    {
      title: "Query Builder",
      url: "/query-builder",
      icon: Table2,
      available: (caps) => caps.query_language === "sql",
    },
    {
      title: "ER-Diagramm",
      url: "/er-diagram",
      icon: Network,
      available: (caps) => caps.foreign_keys,
    },
    { title: "Vergleich", url: "/compare", icon: GitCompare },
    {
      title: "Schema-Vergleich",
      url: "/schema-compare",
      icon: GitCompareArrows,
      available: (caps) => caps.schema_object_copy,
    },
    {
      title: "Gespeicherte Pläne",
      url: "/saved-plan",
      icon: RouteIcon,
      available: (caps) => caps.explain,
    },
  ],
};
