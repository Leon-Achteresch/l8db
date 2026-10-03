import type { ERSchema } from "../../src/lib/db";

const count = Math.max(
  1,
  Math.min(10000, Number(new URLSearchParams(location.search).get("tables")) || 240),
);
const names = Array.from(
  { length: count },
  (_, index) => `table_${String(index).padStart(4, "0")}`,
);
const schema: ERSchema = {
  tables: names.map((name) => ({
    schema: "public",
    name,
    columns: ["id", "parent_id", "name", "created_at"].map((column) => ({
      name: column,
      data_type: column.endsWith("id") ? "integer" : "text",
      is_primary_key: column === "id",
      is_nullable: column !== "id",
    })),
  })),
  foreign_keys: names.slice(1).map((name, index) => ({
    constraint_name: `${name}_parent_fk`,
    from_schema: "public",
    from_table: name,
    from_column: "parent_id",
    to_schema: "public",
    to_table: names[Math.floor(index / 3)],
    to_column: "id",
  })),
};

Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    transformCallback: (callback: unknown) => {
      const id = Math.random();
      Object.assign(window, { [`_${id}`]: callback });
      return id;
    },
    convertFileSrc: (path: string) => path,
    invoke: async (command: string) => {
      if (command === "get_er_schema") return schema;
      if (command === "list_tables") return names.map((name) => ({ schema: "public", name }));
      if (command === "list_schemas") return ["public"];
      if (command === "list_databases") return ["er_demo"];
      if (command === "load_secret") return null;
      if (command === "plugin:dialog|save") {
        Object.assign(window, {
          erExportTableCount: document.querySelectorAll(".react-flow__node-tableNode").length,
          erExportEdgeCount: document.querySelectorAll(".react-flow__edge").length,
        });
        return null;
      }
      return [];
    },
  },
});

localStorage.setItem(
  "l8db.connections",
  JSON.stringify({
    state: {
      connections: [
        {
          id: "er-demo",
          name: "ER Demo",
          kind: "postgres",
          connectionString: "postgresql://demo@localhost/er_demo",
          sslMode: "disable",
        },
      ],
      activeId: "er-demo",
      favoriteServerKeys: [],
      serverOrder: [],
    },
    version: 0,
  }),
);
localStorage.setItem(
  "l8db.settings",
  JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }),
);
localStorage.setItem(
  "l8db.db-selection",
  JSON.stringify({ state: { database: "er_demo", schema: "public" }, version: 0 }),
);
await import("../../src/index.css");
const [
  { createElement },
  { createRoot },
  { QueryClient, QueryClientProvider },
  routing,
  { ErDiagramView },
] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import("@tanstack/react-query"),
  import("@tanstack/react-router"),
  import("../../src/features/er-diagram/er-diagram-view"),
]);
const rootRoute = routing.createRootRoute({ component: routing.Outlet });
const appRoute = routing.createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: routing.Outlet,
});
const workspaceRoute = routing.createRoute({
  getParentRoute: () => appRoute,
  id: "_workspace",
  component: routing.Outlet,
});
const erRoute = routing.createRoute({
  getParentRoute: () => workspaceRoute,
  path: "er-diagram",
  component: ErDiagramView,
});
const router = routing.createRouter({
  routeTree: rootRoute.addChildren([appRoute.addChildren([workspaceRoute.addChildren([erRoute])])]),
  history: routing.createMemoryHistory({ initialEntries: ["/er-diagram"] }),
});
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing ER fixture root");
createRoot(rootElement).render(
  createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    createElement(
      "div",
      { className: "flex h-dvh min-h-0 flex-col" },
      createElement(routing.RouterProvider, { router }),
    ),
  ),
);
