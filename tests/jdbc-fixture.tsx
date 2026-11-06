import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { JdbcManager } from "@/features/drivers/jdbc-manager";
import { refreshDriverStatus, useProvidersStore } from "@/lib/providers";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Fixture root missing");
const lab = window as unknown as {
  __jdbcDriverAvailable: () => boolean;
  __jdbcRefreshDriverStatus: () => Promise<unknown>;
};
lab.__jdbcDriverAvailable = () =>
  useProvidersStore.getState().providers.find((provider) => provider.kind === "jdbc")?.driver_status
    .available ?? false;
lab.__jdbcRefreshDriverStatus = () => refreshDriverStatus("jdbc");
createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <main className="mx-auto max-w-5xl p-6">
      <JdbcManager />
    </main>
  </QueryClientProvider>,
);
