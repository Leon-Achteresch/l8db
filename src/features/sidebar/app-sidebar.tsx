import type * as React from "react";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { AppSidebarPanel } from "@/features/sidebar/app-sidebar-panel";
import { AppSidebarResizeHandle } from "@/features/sidebar/app-sidebar-resize-handle";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { cn } from "@/lib/utils";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isResizing = useSidebarPanel((state) => state.isResizing);
  const { open } = useSidebar();

  if (!open) return null;

  return (
    <Sidebar
      collapsible="none"
      className={cn(
        "relative h-full shrink-0 flex-row overflow-visible",
        "w-(--sidebar-width)",
        isResizing && "[&_[data-slot=sidebar]]:transition-none",
      )}
      {...props}
    >
      <AppSidebarPanel />
      <AppSidebarResizeHandle />
    </Sidebar>
  );
}
