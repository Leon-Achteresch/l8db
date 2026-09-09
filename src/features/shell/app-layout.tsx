import { Outlet } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ConnectionAuthGuard } from "@/features/connections/connection-auth-guard";
import { TransactionPanel } from "@/features/shell/transaction-panel";
import { AppSidebar } from "@/features/sidebar/app-sidebar";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { useTransactionStore } from "@/lib/transactions";
import { WorkspaceStatus } from "./workspace-status";

export function AppLayout() {
  const panelWidth = useSidebarPanel((s) => s.width);
  const panelOpen = useTransactionStore((s) => s.panelOpen);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${panelWidth}px`,
        } as React.CSSProperties
      }
      className="min-h-0 flex-1"
    >
      <ConnectionAuthGuard />
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
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
