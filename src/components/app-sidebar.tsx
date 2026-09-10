import * as React from "react";
import { HomeIcon, InfoIcon } from "lucide-react";

import {
  AppSidebarIconRail,
  type AppSidebarNavItem,
} from "@/components/app-sidebar-icon-rail";
import { Sidebar } from "@/components/ui/sidebar";

const user = {
  name: "shadcn",
  email: "m@example.com",
  avatar: "/avatars/shadcn.jpg",
};

const navItems: AppSidebarNavItem[] = [
  {
    title: "Home",
    url: "/",
    icon: <HomeIcon />,
  },
  {
    title: "About",
    url: "/about",
    icon: <InfoIcon />,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" className="overflow-hidden" {...props}>
      <AppSidebarIconRail user={user} navItems={navItems} />
    </Sidebar>
  );
}
