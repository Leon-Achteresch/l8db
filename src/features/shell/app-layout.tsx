import { Outlet } from "@tanstack/react-router";

import { AppSidebar } from "@/features/sidebar/app-sidebar";
import { TableTabs } from "@/features/shell/table-tabs";
import { TransactionPanel } from "@/features/shell/transaction-panel";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  selectSidebarPanelWidth,
  useSidebarPanel,
} from "@/lib/sidebar-panel";
import { useTransactionStore } from "@/lib/transactions";

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
        <header className="flex shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
          <TableTabs />
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
          {panelOpen && <TransactionPanel />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
