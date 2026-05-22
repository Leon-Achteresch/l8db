import type * as React from "react";

import { AppSidebarIconRail } from "@/components/sidebar/app-sidebar-icon-rail";
import { AppSidebarPanel } from "@/components/sidebar/app-sidebar-panel";
import { appSidebarData } from "@/components/sidebar/app-sidebar-data";
import { Sidebar } from "@/components/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      <AppSidebarIconRail user={appSidebarData.user} />
      <AppSidebarPanel />
    </Sidebar>
  );
}
