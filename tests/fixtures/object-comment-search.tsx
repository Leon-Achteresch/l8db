import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHeaderSearch } from "@/features/shell/app-header-search";
import { useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { ExtensionManager } from "@/lib/extensions/manager";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { SandboxRuntime } from "@/lib/extensions/sandbox-runtime";
import { emitHotkeyAction } from "@/lib/hotkeys";
import { useProvidersStore } from "@/lib/providers";
import { createAppQueryClient, forgetTableCommentMetadata } from "@/lib/query-client";
import { useSettingsStore } from "@/lib/settings";
import "@/index.css";

const client = createAppQueryClient();
client.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } });
useProvidersStore.setState({ loaded: true });
useSettingsStore.setState({ dynamicIsland: false });
useConnectionsStore.setState({
  activeId: "alpha",
  connections: ["alpha", "beta"].map((id) => ({
    id,
    name: id,
    kind: "postgres",
    connectionString: `postgresql://127.0.0.1/${id}`,
    sslMode: "disable",
  })),
});

const tables = (connection: string, database: string, schema: string, names: string[]) =>
  client.setQueryData(
    ["tables", connection, database, schema],
    names.map((name) => ({ schema, name })),
  );
for (const schema of ["public", "billing"]) tables("alpha", "alpha", schema, ["orders"]);
tables("beta", "beta", "public", ["orders"]);
tables("alpha", "other", "public", ["orders"]);
client.setQueryData(["schemas", "alpha", "alpha"], ["public", "billing"]);
client.setQueryData(["schemas", "beta", "beta"], ["public"]);
client.setQueryData(
  ["table-comment", "alpha", "alpha", "public", "orders"],
  "Beleg Kundenaufträge",
);
client.setQueryData(
  ["table-comment", "alpha", "alpha", "billing", "orders"],
  "Beleg Rechnungswesen",
);
client.setQueryData(["table-comment", "beta", "beta", "public", "orders"], "Beleg Beta-Lager");
client.setQueryData(
  ["table-comment", "alpha", "other", "public", "orders"],
  "Beleg andere Datenbank",
);
client.setQueryData(
  ["table-comment", "alpha", "alpha", "public", "incoming"],
  "Beleg veralteter Zielname",
);
client.setQueryData(
  ["columns-detailed", "alpha", "alpha", "public", "orders"],
  [
    { name: "owner", comment: "Beleg Zuständigkeit" },
    {
      name: "memo",
      comment: `${"Vorgeschichte ".repeat(155)}Randmarker ${"Abschnitt ".repeat(600)}HinterGrenze`,
    },
  ],
);
if (new URLSearchParams(location.search).has("large")) {
  const names = Array.from({ length: 700 }, (_, index) => `entity_${index}`);
  tables("alpha", "alpha", "public", names);
  for (const name of names) {
    client.setQueryData(
      ["columns-detailed", "alpha", "alpha", "public", name],
      [
        { name: "left", comment: `${"Allgemeiner Text ".repeat(30)}BatchRot ${name}` },
        { name: "right", comment: `${"Allgemeiner Text ".repeat(30)}BatchBlau ${name}` },
      ],
    );
  }
}

Object.assign(window, {
  changeObjectSearchScope: (next: "alpha" | "beta" | "other") => {
    if (next === "other") useDbSelectionStore.getState().setDatabase("alpha", "other");
    else useConnectionsStore.getState().setActiveId(next);
  },
  renameObjectSearchTable: () => {
    forgetTableCommentMetadata(client, "alpha", "alpha", "public", "orders", "incoming");
    tables("alpha", "alpha", "public", ["incoming"]);
  },
  setRenamedTableComment: () =>
    client.setQueryData(
      ["table-comment", "alpha", "alpha", "public", "incoming"],
      "Beleg neue Tabelle",
    ),
});

function Fixture() {
  return (
    <main className="min-h-dvh bg-background p-4">
      <AppHeaderSearch />
      <button type="button" onClick={() => emitHotkeyAction("objects.search")}>
        Objektsuche öffnen
      </button>
      <Outlet />
    </main>
  );
}

const root = createRootRoute({ component: Fixture });
const home = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
const table = createRoute({
  getParentRoute: () => root,
  path: "/tables/$schema/$table",
  validateSearch: (search: Record<string, unknown>) => ({
    column: typeof search.column === "string" ? search.column : undefined,
  }),
  component: function FixtureTarget() {
    const { schema, table: name } = table.useParams();
    const { column } = table.useSearch();
    return (
      <output aria-label="Navigationsziel">
        {[schema, name, column].filter(Boolean).join(".")}
      </output>
    );
  },
});
const router = createRouter({
  routeTree: root.addChildren([home, table]),
  history: createMemoryHistory(),
});
const extensions = new ExtensionManager(
  { list: async () => [] } as unknown as ConstructorParameters<typeof ExtensionManager>[0],
  new SandboxRuntime(),
  {} as ConstructorParameters<typeof ExtensionManager>[2],
  "0.7.0",
);
const host = document.getElementById("root");
if (!host) throw Error("Missing fixture root");
createRoot(host).render(
  <ExtensionHostContext.Provider value={extensions}>
    <ThemeProvider attribute="class" defaultTheme="system">
      <HotkeysProvider>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </QueryClientProvider>
      </HotkeysProvider>
    </ThemeProvider>
  </ExtensionHostContext.Provider>,
);
