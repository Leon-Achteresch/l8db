import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider, useTheme } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryView } from "../../src/features/query/query-view";
import { DataTable } from "../../src/features/table/data-table";
import { RowWatchProvider } from "../../src/features/table/row-watch-provider";
import { RowWatches } from "../../src/features/table/row-watches";
import { InvestigationsButton } from "../../src/features/workbench/investigations-button";
import { useConnectionsStore } from "../../src/lib/connections";
import { ExtensionManager } from "../../src/lib/extensions/manager";
import { ExtensionHostContext } from "../../src/lib/extensions/react-context";
import { SandboxRuntime } from "../../src/lib/extensions/sandbox-runtime";
import { useHotkeysStore } from "../../src/lib/hotkeys";
import { useQueryWorkspace } from "../../src/lib/query-workspace";
import { useTableTabs } from "../../src/lib/table-tabs";
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
      sql: "SELECT id FROM public.customers",
    },
  ],
});
useQueryWorkspace.getState().update({ navigatorVisible: false });
useHotkeysStore.setState({ overrides: { "query.run": "Mod+Shift+Y" } });
const extensions = new ExtensionManager(
  { list: async () => [] } as unknown as ConstructorParameters<typeof ExtensionManager>[0],
  new SandboxRuntime(),
  {} as ConstructorParameters<typeof ExtensionManager>[2],
  "0.7.0",
);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const { setTheme, resolvedTheme } = useTheme();
  const [table, setTable] = useState(false);
  const [revision, setRevision] = useState(0);
  const rows = Array.from({ length: 5_000 }, (_, id) => ({
    id: String(id),
    value: id === 0 && revision ? "geändert" : "Original",
    __ctid__: String(id),
  }));
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex gap-2 border-b p-2">
        <InvestigationsButton />
        <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          Design wechseln
        </button>
        <button type="button" onClick={() => setTable(!table)}>
          Tabelle umschalten
        </button>
        {table && (
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Neu laden
          </button>
        )}
      </div>
      {table ? (
        <RowWatchProvider scope="fixture-table" rows={rows}>
          <RowWatches scope="fixture-table" />
          <DataTable
            watchScope="fixture-table"
            stateKey="fixture-table"
            currentSchema="public"
            currentTable="customers"
            columns={["id", "value"]}
            data={rows}
            sorting={[]}
            onSortingChange={() => {}}
            emptyMessage="Keine Daten"
            columnDetails={[
              { name: "id", data_type: "text", is_primary_key: true, is_nullable: false },
            ]}
          />
        </RowWatchProvider>
      ) : (
        <Outlet />
      )}
    </main>
  );
}
function QueryScreen() {
  const { id } = queryRoute.useParams();
  return <QueryView tabId={id} />;
}
const rootRoute = createRootRoute({ component: Fixture });
const queryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/query/$id",
  component: QueryScreen,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([queryRoute]),
  history: createMemoryHistory({ initialEntries: ["/query/test"] }),
});
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root fehlt.");
createRoot(root).render(
  <ExtensionHostContext.Provider value={extensions}>
    <ThemeProvider attribute="class" defaultTheme="dark">
      <HotkeysProvider>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </HotkeysProvider>
    </ThemeProvider>
  </ExtensionHostContext.Provider>,
);
Object.assign(window, {
  workbenchFixture: {
    getTabs: () => useTableTabs.getState().tabs,
    setSql: (sql: string) => {
      const tab = useTableTabs
        .getState()
        .tabs.find(
          (entry) =>
            entry.kind === "query" && entry.id === router.state.location.pathname.split("/").at(-1),
        );
      if (tab?.kind === "query") useTableTabs.getState().updateQuerySql(tab.id, sql);
    },
  },
});
