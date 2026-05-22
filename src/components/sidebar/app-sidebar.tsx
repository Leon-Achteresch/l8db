import type * as React from "react";

import { AppSidebarIconRail } from "@/components/sidebar/app-sidebar-icon-rail";
import { AppSidebarPanel } from "@/components/sidebar/app-sidebar-panel";
import { appSidebarData } from "@/components/sidebar/app-sidebar-data";
import { Sidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useSidebarPanel } from "@/lib/sidebar-panel";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isResizing = useSidebarPanel((state) => state.isResizing);

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        "top-[var(--app-header-height)]! bottom-0! h-[calc(100dvh-var(--app-header-height))]! inset-y-auto!",
        "overflow-hidden *:data-[sidebar=sidebar]:flex-row",
        isResizing && "transition-none!",
      )}
      {...props}
    >
      <AppSidebarIconRail user={appSidebarData.user} />
      <AppSidebarPanel />
    </Sidebar>
  );
}
