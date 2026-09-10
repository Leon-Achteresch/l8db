import { Home, Info, type LucideIcon, Network, SquareTerminalIcon } from "lucide-react";

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
    { title: "ER-Diagramm", url: "/er-diagram", icon: Network },
    { title: "Über", url: "/about", icon: Info },
  ],
};
