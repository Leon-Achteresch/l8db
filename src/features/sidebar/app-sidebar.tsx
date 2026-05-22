import type * as React from "react";

import { AppSidebarIconRail } from "@/features/sidebar/app-sidebar-icon-rail";
import { AppSidebarPanel } from "@/features/sidebar/app-sidebar-panel";
import { AppSidebarResizeHandle } from "@/features/sidebar/app-sidebar-resize-handle";
import { appSidebarData } from "@/features/sidebar/app-sidebar-data";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useSidebarPanel } from "@/lib/sidebar-panel";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isResizing = useSidebarPanel((state) => state.isResizing);
  const { open } = useSidebar();

  return (
    <Sidebar
      collapsible="none"
      className={cn(
        "relative h-full shrink-0 flex-row overflow-visible",
        open
          ? "w-(--sidebar-width)"
          : "w-[calc(var(--sidebar-width-icon)+1px)]",
        isResizing && "[&_[data-slot=sidebar]]:transition-none",
      )}
      {...props}
    >
      <AppSidebarIconRail user={appSidebarData.user} />
      {open && <AppSidebarPanel />}
      {open && <AppSidebarResizeHandle />}
    </Sidebar>
  );
}
