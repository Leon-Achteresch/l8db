import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { SidebarScopeSelects } from "@/features/sidebar/app-sidebar-panel/sidebar-scope-selects";
import { useSidebarScope } from "@/features/sidebar/app-sidebar-panel/use-sidebar-scope";
import { type SavedConnection, useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { DEFAULT_TERMS, FALLBACK_PROVIDERS, useProvidersStore } from "@/lib/providers";
import "@/index.css";

const postgres = FALLBACK_PROVIDERS[0];
useProvidersStore.setState({
  loaded: true,
  providers: [
    postgres,
    {
      ...postgres,
      id: "influxdb",
      kind: "influxdb",
      name: "InfluxDB",
      default_port: 8086,
      url_schemes: ["influxdb"],
      capabilities: {
        ...postgres.capabilities,
        schemas: false,
        terms: { ...DEFAULT_TERMS, database: "Bucket", schema: "Bucket" },
      },
    },
  ],
});

function connectionString(org: string) {
  return `influxdb://127.0.0.1:8086/metrics?org=${org}`;
}

const nativeConnections = (
  window as Window & { __L8DB_A45_NATIVE_CONNECTIONS__?: SavedConnection[] }
).__L8DB_A45_NATIVE_CONNECTIONS__;
const browserConnections: SavedConnection[] = ["alpha", "beta", "legacy", "failure"].map((id) => ({
  id,
  kind: "influxdb",
  name: id,
  connectionString: connectionString(id),
  sslMode: "disable",
}));
browserConnections.push({
  id: "postgres",
  kind: "postgres",
  name: "postgres",
  connectionString: "postgresql://127.0.0.1/metrics",
  sslMode: "disable",
});
const connections = nativeConnections ?? browserConnections;
useConnectionsStore.setState({ activeId: "alpha", connections });

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});

function Fixture() {
  const connection = useActiveConnection();
  const caps = useActiveCapabilities();
  const scope = useSidebarScope(connections, connection);
  return (
    <main className="grid min-h-dvh content-start gap-5 bg-background p-4">
      <nav className="flex flex-wrap gap-3 text-sm">
        {connections.map(({ id }) => (
          <button
            key={id}
            type="button"
            onClick={() => useConnectionsStore.getState().setActiveId(id)}
          >
            {id}
          </button>
        ))}
        {!nativeConnections && (
          <button
            type="button"
            onClick={() =>
              useConnectionsStore.setState((state) => ({
                connections: state.connections.map((entry) =>
                  entry.id === "beta"
                    ? { ...entry, connectionString: connectionString("gamma") }
                    : entry,
                ),
              }))
            }
          >
            Organisation ändern
          </button>
        )}
      </nav>
      <aside className="w-full max-w-60">
        {connection && (
          <SidebarScopeSelects
            activeConnection={connection}
            caps={caps}
            isSwitching={false}
            scope={scope}
          />
        )}
      </aside>
    </main>
  );
}

const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory() });
const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
createRoot(root).render(
  <ThemeProvider attribute="class" defaultTheme="system">
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </ThemeProvider>,
);
