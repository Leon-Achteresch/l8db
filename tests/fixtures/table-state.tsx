import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { TableView } from "../../src/features/table/table-view";
import { useConnectionsStore } from "../../src/lib/connections";
import { useDbSelectionStore } from "../../src/lib/db-selection";
import { ExtensionManager } from "../../src/lib/extensions/manager";
import { ExtensionHostContext } from "../../src/lib/extensions/react-context";
import { SandboxRuntime } from "../../src/lib/extensions/sandbox-runtime";
import { useSettingsStore } from "../../src/lib/settings";
import "../../src/index.css";

useConnectionsStore.setState({
  activeId: "state-test",
  connections: [
    {
      id: "state-test",
      name: "State test",
      kind: "postgres",
      connectionString: "postgresql://localhost/first",
      sslMode: "disable",
    },
  ],
});
useDbSelectionStore.getState().setDatabase("state-test", "first");
useSettingsStore.setState({ rowLimit: 100 });
const extensions = new ExtensionManager(
  { list: async () => [] } as unknown as ConstructorParameters<typeof ExtensionManager>[0],
  new SandboxRuntime(),
  {} as ConstructorParameters<typeof ExtensionManager>[2],
  "0.7.0",
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

function App() {
  return (
    <div className="flex h-dvh flex-col">
      <nav className="flex shrink-0 gap-4">
        <Link to="/tables/$schema/$table" params={{ schema: "public", table: "customers" }}>
          Customers
        </Link>
        <Link to="/tables/$schema/$table" params={{ schema: "public", table: "orders" }}>
          Orders
        </Link>
        <Link
          to="/tables/$schema/$table"
          params={{ schema: "public", table: "customers" }}
          search={{ fkFilter: '"id" = 7' }}
        >
          Related row
        </Link>
        <button
          type="button"
          onClick={() => useDbSelectionStore.getState().setDatabase("state-test", "first")}
        >
          Database A
        </button>
        <button
          type="button"
          onClick={() => useDbSelectionStore.getState().setDatabase("state-test", "second")}
        >
          Database B
        </button>
      </nav>
      <Outlet />
    </div>
  );
}

const root = createRootRoute({ component: App });
const app = createRoute({ getParentRoute: () => root, id: "_app" });
const workspace = createRoute({ getParentRoute: () => app, id: "_workspace" });
const table = createRoute({
  getParentRoute: () => workspace,
  path: "tables/$schema/$table",
  validateSearch: (search: Record<string, unknown>) => ({
    fkFilter: typeof search.fkFilter === "string" ? search.fkFilter : undefined,
  }),
  component: () => {
    const params = table.useParams();
    const search = table.useSearch();
    return <TableView key={params.table} {...params} {...search} />;
  },
});
const router = createRouter({
  routeTree: root.addChildren([app.addChildren([workspace.addChildren([table])])]),
  history: createMemoryHistory({ initialEntries: ["/tables/public/customers"] }),
});
createRoot(document.getElementById("root")!).render(
  <ExtensionHostContext.Provider value={extensions}>
    <HotkeysProvider>
      <TooltipProvider>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </TooltipProvider>
    </HotkeysProvider>
  </ExtensionHostContext.Provider>,
);
