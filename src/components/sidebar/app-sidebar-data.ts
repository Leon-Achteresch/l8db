import { Database, Home, Info, type LucideIcon } from "lucide-react";

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
    { title: "Verbindungen", url: "/connections", icon: Database },
    { title: "Über", url: "/about", icon: Info },
  ],
};
