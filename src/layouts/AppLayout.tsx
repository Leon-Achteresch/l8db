import { Outlet } from "@tanstack/react-router";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { TableTabs } from "@/components/table/table-tabs";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useSidebarPanel } from "@/lib/sidebar-panel";

export function AppLayout() {
  const panelWidth = useSidebarPanel((state) => state.width);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `calc(var(--sidebar-width-icon) + 1px + ${panelWidth}px)`,
        } as React.CSSProperties
      }
      className="min-h-0 flex-1"
    >
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <TableTabs />
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
