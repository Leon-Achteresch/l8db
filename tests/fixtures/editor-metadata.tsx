import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionEditor } from "@/features/connections/connection-editor";
import { QueryView } from "@/features/query/query-view";
import SqlIntellisenseSync from "@/features/shell/sql-intellisense-sync";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { ExtensionManager } from "@/lib/extensions/manager";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { SandboxRuntime } from "@/lib/extensions/sandbox-runtime";
import { ctx } from "@/lib/monaco-intellisense/context";
import { useDatabasesQuery } from "@/lib/queries";
import { useTableRlsQuery } from "@/lib/queries/admin-queries";
import { useForeignKeysQuery } from "@/lib/queries/table-meta-queries";
import { createAppQueryClient } from "@/lib/query-client";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useTableTabs } from "@/lib/table-tabs";
import "@/index.css";

const tab = useTableTabs.getState().openQueryTab();
useTableTabs.getState().updateQuerySql(tab, "SELECT 1 AS value");
const secondTab = useTableTabs.getState().openQueryTab();
const client = createAppQueryClient();
client.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } });
useQueryWorkspace.getState().update({ navigatorVisible: true });

Object.assign(window, {
  editorCatalog: () => ({
    connection: ctx.connection?.id,
    database: ctx.database,
    columns: ctx.registry.columns.length,
    functions: ctx.registry.functions?.map((object) => object.name) ?? [],
    procedures: ctx.registry.procedures?.map((object) => object.name) ?? [],
  }),
});

function EditorMetadataFixture() {
  const active = useActiveConnection();
  const [editing, setEditing] = useState(false);
  const [queryTab, setQueryTab] = useState(tab);
  const databases = useDatabasesQuery();
  const keys = useForeignKeysQuery("public", "required");
  const rls = useTableRlsQuery("public", "required");
  return (
    <main className="flex h-dvh flex-col">
      <div className={editing ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <div className="flex flex-wrap gap-2 p-2">
          <button type="button" onClick={() => setEditing(true)}>
            Verbindung bearbeiten
          </button>
          <button
            type="button"
            onClick={() => useConnectionsStore.getState().setActiveId("legacy")}
          >
            Altverbindung
          </button>
          <button
            type="button"
            onClick={() => useConnectionsStore.getState().setActiveId("manual")}
          >
            Manuelle Verbindung
          </button>
          <button
            type="button"
            onClick={() => useDbSelectionStore.getState().setDatabase("manual", "second")}
          >
            Wechseldatenbank
          </button>
          <button
            type="button"
            onClick={() => useDbSelectionStore.getState().setDatabase("manual", "manual")}
          >
            Erste Datenbank
          </button>
          <button type="button" onClick={() => setQueryTab(tab)}>
            Erster SQL-Tab
          </button>
          <button type="button" onClick={() => setQueryTab(secondTab)}>
            Zweiter SQL-Tab
          </button>
          <output aria-label="Pflichtmetadaten">
            {databases.isSuccess && keys.isSuccess && rls.isSuccess ? "Bereit" : "Lädt"}
          </output>
        </div>
        <SqlIntellisenseSync />
        <div className="min-h-0 flex-1">
          <QueryView tabId={queryTab} />
        </div>
      </div>
      {editing && active && (
        <ConnectionEditor
          connection={active}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
    </main>
  );
}

const routeTree = createRootRoute({ component: EditorMetadataFixture });
const router = createRouter({ routeTree, history: createMemoryHistory() });
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
