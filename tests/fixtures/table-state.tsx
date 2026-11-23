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
import { useActiveDatabase, useDbSelectionStore } from "../../src/lib/db-selection";
import { ExtensionManager } from "../../src/lib/extensions/manager";
import { ExtensionHostContext } from "../../src/lib/extensions/react-context";
import { SandboxRuntime } from "../../src/lib/extensions/sandbox-runtime";
import { FALLBACK_PROVIDERS, useProvidersStore } from "../../src/lib/providers";
import { useSettingsStore } from "../../src/lib/settings";
import "../../src/index.css";

const flags = new URLSearchParams(location.search);
const testPersistence = flags.has("persistence");
const testMergeEngine = flags.has("merge-engine");
if (testPersistence || testMergeEngine) useProvidersStore.setState({ loaded: true });
if (testMergeEngine) {
  const postgres = FALLBACK_PROVIDERS[0];
  useProvidersStore.setState({
    providers: [
      ...FALLBACK_PROVIDERS,
      {
        ...postgres,
        id: "clickhouse",
        kind: "clickhouse",
        name: "ClickHouse",
        url_schemes: ["clickhouse"],
        capabilities: {
          ...postgres.capabilities,
          row_edit: false,
          transactions: false,
          foreign_keys: false,
          sort: "columns",
        },
      },
    ],
  });
}

useConnectionsStore.setState({
  activeId: "state-test",
  connections: [
    {
      id: "state-test",
      name: "State test",
      kind: testMergeEngine ? "clickhouse" : "postgres",
      connectionString: testMergeEngine
        ? "clickhouse://localhost/first"
        : "postgresql://localhost/first",
      sslMode: "disable",
    },
    ...(testPersistence || testMergeEngine
      ? [
          {
            id: "other-postgres",
            name: "Other PostgreSQL",
            kind: testMergeEngine ? ("clickhouse" as const) : ("postgres" as const),
            connectionString: testMergeEngine
              ? "clickhouse://127.0.0.1:30212/first"
              : "postgresql://127.0.0.1:30212/first",
            sslMode: "disable" as const,
          },
          {
            id: "other-provider",
            name: "Other Provider",
            kind: "mysql" as const,
            connectionString: "mysql://127.0.0.1:30213/first",
            sslMode: "disable" as const,
          },
        ]
      : []),
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
  const database = useActiveDatabase();
  const schema = testMergeEngine ? (database ?? "first") : "public";
  return (
    <div className="flex h-dvh flex-col">
      <nav
        className={
          testPersistence || testMergeEngine
            ? "flex shrink-0 flex-wrap gap-2 p-2 text-xs"
            : "flex shrink-0 gap-4"
        }
      >
        <Link to="/tables/$schema/$table" params={{ schema, table: "customers" }}>
          Customers
        </Link>
        <Link to="/tables/$schema/$table" params={{ schema, table: "orders" }}>
          Orders
        </Link>
        <Link
          to="/tables/$schema/$table"
          params={{ schema, table: "customers" }}
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
        {testMergeEngine && (
          <Link to="/tables/$schema/$table" params={{ schema, table: "old_metadata" }}>
            Old metadata
          </Link>
        )}
        {(testPersistence || testMergeEngine) && (
          <>
            <Link to="/tables/$schema/$table" params={{ schema: "scratch", table: "customers" }}>
              Cached customers
            </Link>
            <Link to="/tables/$schema/$table" params={{ schema: "pg_temp_3", table: "customers" }}>
              Temporary customers
            </Link>
            <Link to="/tables/$schema/$table" params={{ schema: "unknown", table: "customers" }}>
              Unknown customers
            </Link>
            <button
              type="button"
              onClick={() => useConnectionsStore.getState().setActiveId("other-postgres")}
            >
              Other connection
            </button>
            <button
              type="button"
              onClick={() => useConnectionsStore.getState().setActiveId("other-provider")}
            >
              Other provider
            </button>
          </>
        )}
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
  history: createMemoryHistory({
    initialEntries: [testMergeEngine ? "/tables/first/customers" : "/tables/public/customers"],
  }),
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
