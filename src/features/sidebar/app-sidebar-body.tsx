import type * as React from "react";
import { memo } from "react";
import { Sidebar } from "@/components/ui/sidebar";
import { AppSidebarPanel } from "@/features/sidebar/app-sidebar-panel";
import { AppSidebarResizeHandle } from "@/features/sidebar/app-sidebar-resize-handle";
import { PaneSidebarScope } from "@/features/sidebar/pane-sidebar-scope";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { cn } from "@/lib/utils";

export const AppSidebarBody = memo(function AppSidebarBody(
  props: React.ComponentProps<typeof Sidebar>,
) {
  const isResizing = useSidebarPanel((state) => state.isResizing);
  return (
    <Sidebar
      collapsible="none"
      className={cn(
        "relative h-full shrink-0 flex-row overflow-visible",
        "w-(--sidebar-width)",
        isResizing && "[&_*]:transition-none!",
      )}
      {...props}
    >
      <PaneSidebarScope>
        <AppSidebarPanel />
      </PaneSidebarScope>
      <AppSidebarResizeHandle />
    </Sidebar>
  );
});
