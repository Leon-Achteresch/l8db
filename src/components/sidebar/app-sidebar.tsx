import type * as React from "react";

import { AppSidebarIconRail } from "@/components/sidebar/app-sidebar-icon-rail";
import { AppSidebarPanel } from "@/components/sidebar/app-sidebar-panel";
import { AppSidebarResizeHandle } from "@/components/sidebar/app-sidebar-resize-handle";
import { appSidebarData } from "@/components/sidebar/app-sidebar-data";
import { Sidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useSidebarPanel } from "@/lib/sidebar-panel";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isResizing = useSidebarPanel((state) => state.isResizing);

  return (
    <Sidebar
      collapsible="none"
      className={cn(
        "relative h-full w-(--sidebar-width) shrink-0 flex-row overflow-visible",
        isResizing && "[&_[data-slot=sidebar]]:transition-none",
      )}
      {...props}
    >
      <AppSidebarIconRail user={appSidebarData.user} />
      <AppSidebarPanel />
      <AppSidebarResizeHandle />
    </Sidebar>
  );
}
