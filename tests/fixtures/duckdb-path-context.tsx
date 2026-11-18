import { HotkeysProvider } from "@tanstack/react-hotkeys";
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
import { QueryView } from "@/features/query/query-view";
import { useConnectionsStore } from "@/lib/connections";
import { ExtensionManager } from "@/lib/extensions/manager";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { SandboxRuntime } from "@/lib/extensions/sandbox-runtime";
import { monaco } from "@/lib/monaco";
import { FALLBACK_PROVIDERS, useProvidersStore } from "@/lib/providers";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useTableTabs } from "@/lib/table-tabs";
import { useTransactionStore } from "@/lib/transactions";
import "@/index.css";

const postgres = FALLBACK_PROVIDERS[0];
useProvidersStore.setState({
  loaded: true,
  providers: [
    ...FALLBACK_PROVIDERS,
    {
      ...postgres,
      id: "duckdb",
      kind: "duckdb",
      name: "DuckDB",
      file_based: true,
      default_port: null,
      url_schemes: ["duckdb"],
    },
  ],
});
useConnectionsStore.setState({
  activeId: "duckdb-a",
  connections: [
    {
      id: "duckdb-a",
      name: "Fixture A",
      kind: "duckdb",
      connectionString: "duckdb:///synthetic-a.duckdb",
      sslMode: "disable",
      editorMetadataPrefetch: false,
    },
    {
      id: "duckdb-b",
      name: "Fixture B",
      kind: "duckdb",
      connectionString: "duckdb:///synthetic-b.duckdb",
      sslMode: "disable",
      editorMetadataPrefetch: false,
    },
    {
      id: "postgres",
      name: "Other provider",
      kind: "postgres",
      connectionString: "postgresql://127.0.0.1/fixture",
      sslMode: "disable",
      editorMetadataPrefetch: false,
    },
  ],
});
useQueryWorkspace.getState().update({ navigatorVisible: false });
const tab = useTableTabs.getState().openQueryTab();
useTableTabs.getState().updateQuerySql(tab, "SELECT * FROM read_csv('sample.csv');");

const fixtureEditor = () =>
  monaco.editor.getEditors().find((item) => item.getDomNode()?.closest("[data-fixture-query]"));
Object.assign(window, {
  duckdbPathFixture: {
    sql: () => fixtureEditor()?.getValue(),
    edit: (sql: string) => fixtureEditor()?.getModel()?.setValue(sql),
    switchConnection: (id: string) => useConnectionsStore.getState().setActiveId(id),
    replaceConnection: () =>
      useConnectionsStore.setState((state) => ({
        connections: state.connections.map((connection) =>
          connection.id === state.activeId
            ? { ...connection, connectionString: "duckdb:///synthetic-changed.duckdb" }
            : connection,
        ),
      })),
    setTransaction: (active: boolean) =>
      useTransactionStore.setState({
        transactions: active
          ? [
              {
                txId: "transaction-fixture",
                connectionId: "duckdb-a",
                connectionName: "Fixture A",
                scope: { type: "query" },
                changes: [],
                startedAt: 0,
              },
            ]
          : [],
      }),
  },
});

function Fixture() {
  return (
    <div data-fixture-query className="flex h-dvh min-h-0 flex-col">
      <QueryView tabId={tab} />
    </div>
  );
}

const extensions = new ExtensionManager(
  { list: async () => [] } as unknown as ConstructorParameters<typeof ExtensionManager>[0],
  new SandboxRuntime(),
  {} as ConstructorParameters<typeof ExtensionManager>[2],
  "0.7.0",
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory() });
const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
createRoot(root).render(
  <ExtensionHostContext.Provider value={extensions}>
    <ThemeProvider attribute="class" defaultTheme="system">
      <TooltipProvider>
        <HotkeysProvider>
          <QueryClientProvider client={client}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </HotkeysProvider>
      </TooltipProvider>
    </ThemeProvider>
  </ExtensionHostContext.Provider>,
);
