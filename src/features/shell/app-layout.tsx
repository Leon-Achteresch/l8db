import { Outlet } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TableTabs } from "@/features/shell/table-tabs";
import { TransactionPanel } from "@/features/shell/transaction-panel";
import { AppSidebar } from "@/features/sidebar/app-sidebar";
import { selectSidebarPanelWidth, useSidebarPanel } from "@/lib/sidebar-panel";
import { useTransactionStore } from "@/lib/transactions";
import { WorkspaceStatus } from "./workspace-status";

export function AppLayout() {
  const panelWidth = useSidebarPanel(selectSidebarPanelWidth);
  const panelOpen = useTransactionStore((s) => s.panelOpen);

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
        <header className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/70 px-3 py-1 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
          <TableTabs />
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
          {panelOpen && <TransactionPanel />}
        </div>
        <WorkspaceStatus />
      </SidebarInset>
    </SidebarProvider>
  );
}
