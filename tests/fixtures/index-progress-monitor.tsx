import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MonitorView } from "@/features/monitor/monitor-view";
import { useConnectionsStore } from "@/lib/connections";
import { useProvidersStore } from "@/lib/providers";
import "@/index.css";

useProvidersStore.setState({ loaded: true });
useConnectionsStore.setState({
  activeId: "alpha",
  connections: [
    {
      id: "alpha",
      name: "Fixture Alpha",
      kind: "postgres",
      connectionString: "postgresql://127.0.0.1/alpha",
      sslMode: "disable",
    },
    {
      id: "beta",
      name: "Fixture Beta",
      kind: "postgres",
      connectionString: "postgresql://127.0.0.1/beta",
      sslMode: "disable",
    },
    {
      id: "other",
      name: "Fixture Other",
      kind: "mysql",
      connectionString: "mysql://127.0.0.1/other",
      sslMode: "disable",
    },
  ],
});

function MonitorFixture() {
  const setActiveId = useConnectionsStore((state) => state.setActiveId);
  return (
    <div className="flex h-dvh flex-col">
      <nav aria-label="Fixture-Verbindungen" className="flex gap-4 p-2 text-xs">
        <button type="button" onClick={() => setActiveId("alpha")}>
          Alpha
        </button>
        <button type="button" onClick={() => setActiveId("beta")}>
          Beta
        </button>
        <button type="button" onClick={() => setActiveId("other")}>
          MySQL
        </button>
      </nav>
      <MonitorView />
    </div>
  );
}

const routeTree = createRootRoute({ component: MonitorFixture });
const router = createRouter({ routeTree, history: createMemoryHistory() });
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
createRoot(host).render(
  <ThemeProvider attribute="class" defaultTheme="system">
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TooltipProvider>
  </ThemeProvider>,
);
