import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { DashboardEditor } from "@/features/dashboard/dashboard-editor";
import { useAiStore } from "@/lib/ai/store";
import * as design from "@/lib/dashboard-design";
import { type Dashboard, useDashboardsStore } from "@/lib/dashboards";
import "@/index.css";

const runtime = window as unknown as Record<string, unknown>;
runtime.dashboardDesign = design;
runtime.dashboardDesignStore = useDashboardsStore;
runtime.dashboardDesignAi = useAiStore;
const queryClient = new QueryClient();
const id = "design-fixture";
if (!useDashboardsStore.getState().dashboards.some((dashboard) => dashboard.id === id)) {
  const dashboard: Dashboard = {
    id,
    connectionId: "design-connection",
    database: null,
    name: "Design Studio",
    datasets: [],
    widgets: Array.from({ length: 60 }, (_, index) => ({
      id: `card-${index}`,
      chart: "kpi",
      datasetId: null,
      title: `Kennzahl ${index + 1}`,
      period: "all",
      x: (index % 4) * 3,
      y: Math.floor(index / 4) * 4,
      w: 3,
      h: 4,
    })),
    refreshSec: 0,
    locked: true,
    createdAt: 1,
  };
  useDashboardsStore.setState((state) => ({ dashboards: [...state.dashboards, dashboard] }));
}

function Fixture() {
  const dashboard = useDashboardsStore((state) => state.dashboards.find((item) => item.id === id)!);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <div data-testid="outside" className="border-b p-3 text-sm">
          App-Oberfläche außerhalb des Dashboards
        </div>
        <DashboardEditor
          dashboard={dashboard}
          siblings={[dashboard]}
          connectionId={dashboard.connectionId}
          database={null}
        />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
