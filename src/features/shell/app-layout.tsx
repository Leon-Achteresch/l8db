import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ConnectionAuthGuard } from "@/features/connections/connection-auth-guard";
import { DeferredOutlet } from "@/features/shell/deferred-outlet";
import { TransactionPanel } from "@/features/shell/transaction-panel";
import { AppSidebar } from "@/features/sidebar/app-sidebar";
import { VersioningPanel } from "@/features/versioning/versioning-panel";
import { useAiStore } from "@/lib/ai/store";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { useSettingsStore } from "@/lib/settings";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { useTransactionStore } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import { WorkspaceStatus } from "./workspace-status";

export function AppLayout() {
  const fullAiPage = useRouterSelect((state) => state.location.pathname === "/ai");
  const aiSplit = useAiStore((state) => state.open) && !fullAiPage;
  const easyMode = useSettingsStore((state) => state.easyMode);
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
      <PanelErrorBoundary
        label="Die Seitenleiste"
        source="sidebar"
        className="w-(--sidebar-width) shrink-0"
      >
        <AppSidebar />
      </PanelErrorBoundary>
      <SidebarInset
        className={cn(
          "overflow-hidden rounded-tl-lg border-t border-l",
          aiSplit && "!rounded-xl !border !shadow-none",
        )}
      >
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <DeferredOutlet />
          </div>
          {panelOpen && (
            <PanelErrorBoundary
              label="Das Transaktions-Panel"
              source="transaction-panel"
              className="w-80 shrink-0 border-l"
            >
              <TransactionPanel />
            </PanelErrorBoundary>
          )}
          {!easyMode && (
            <PanelErrorBoundary
              label="Das Versionierungs-Panel"
              source="versioning-panel"
              className="w-80 shrink-0 border-l"
            >
              <VersioningPanel />
            </PanelErrorBoundary>
          )}
        </div>
        <WorkspaceStatus />
      </SidebarInset>
    </SidebarProvider>
  );
}
