import {
  FileText,
  GaugeIcon,
  GitCompare,
  HammerIcon,
  Home,
  Info,
  type LucideIcon,
  Network,
  Route as RouteIcon,
  SquareTerminalIcon,
  Table2,
} from "lucide-react";

import type { FileRouteTypes } from "@/routeTree.gen";

export type AppSidebarNavItem = {
  title: string;
  url: FileRouteTypes["to"];
  icon: LucideIcon;
};

export const appSidebarData: { navMain: AppSidebarNavItem[] } = {
  navMain: [
    { title: "Übersicht", url: "/", icon: Home },
    { title: "SQL-Arbeitsplatz", url: "/query", icon: SquareTerminalIcon },
    { title: "Invalid Objects", url: "/invalid-objects", icon: HammerIcon },
    { title: "Monitor", url: "/monitor", icon: GaugeIcon },
    { title: "Query Builder", url: "/query-builder", icon: Table2 },
    { title: "ER-Diagramm", url: "/er-diagram", icon: Network },
    { title: "Vergleich", url: "/compare", icon: GitCompare },
    { title: "Gespeicherte Pläne", url: "/saved-plan", icon: RouteIcon },
    { title: "Über", url: "/about", icon: Info },
    { title: "Release Notes", url: "/release-notes", icon: FileText },
  ],
};
