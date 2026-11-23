import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { HealthView } from "@/features/health/health-view";
import { useConnectionsStore } from "@/lib/connections";
import "@/index.css";

useConnectionsStore.setState({
  activeId: "health",
  connections: [
    {
      id: "health",
      kind: "postgres",
      name: "Fixture",
      connectionString: "postgresql://127.0.0.1/health",
      sslMode: "disable",
    },
  ],
});

const route = createRootRoute({
  component: () => (
    <main className="flex h-dvh flex-col">
      <HealthView />
    </main>
  ),
});
const router = createRouter({ routeTree: route, history: createMemoryHistory() });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");

createRoot(root).render(
  <ThemeProvider attribute="class" defaultTheme="system">
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </ThemeProvider>,
);
