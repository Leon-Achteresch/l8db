import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { QueryView } from "../../src/features/query/query-view";
import { useConnectionsStore } from "../../src/lib/connections";
import { useTableTabs } from "../../src/lib/table-tabs";
import { useQueryWorkspace } from "../../src/lib/query-workspace";
import { useHotkeysStore } from "../../src/lib/hotkeys";
import "../../src/index.css";

useConnectionsStore.setState({
  activeId: "query-test",
  connections: [
    {
      id: "query-test",
      name: "Local development",
      kind: "postgres",
      connectionString: "postgresql://localhost/workspace_test",
      sslMode: "disable",
    },
  ],
});
useTableTabs.setState({
  tabs: [
    {
      kind: "query",
      id: "test",
      title: "Revenue analysis",
      sql: "SELECT id, email, created_at\nFROM public.customers\nWHERE created_at >= '2026-01-01'\nORDER BY created_at DESC;\n\nSELECT count(*)\nFROM public.orders;",
    },
  ],
});
useQueryWorkspace.getState().update({ navigatorVisible: true });
useHotkeysStore.setState({ overrides: { "query.run": "Mod+Shift+Y" } });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const rootRoute = createRootRoute({ component: () => <QueryView tabId="test" /> });
const router = createRouter({ routeTree: rootRoute });
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="dark">
    <HotkeysProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </HotkeysProvider>
  </ThemeProvider>,
);
