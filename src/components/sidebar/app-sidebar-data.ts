import { Home, Info, Network, SquareTerminalIcon, type LucideIcon } from "lucide-react";

import type { FileRouteTypes } from "@/routeTree.gen";

export type AppSidebarNavItem = {
  title: string;
  url: FileRouteTypes["to"];
  icon: LucideIcon;
};

export type AppSidebarUser = {
  name: string;
  email: string;
  avatar: string;
};

export const appSidebarData: {
  user: AppSidebarUser;
  navMain: AppSidebarNavItem[];
} = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    { title: "Home", url: "/", icon: Home },
    { title: "Query Editor", url: "/query", icon: SquareTerminalIcon },
    { title: "ER-Diagramm", url: "/er-diagram", icon: Network },
    { title: "Über", url: "/about", icon: Info },
  ],
};
