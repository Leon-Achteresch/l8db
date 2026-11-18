import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TableColumnsList } from "@/features/table/table-columns-list";
import { useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { useProvidersStore } from "@/lib/providers";
import "@/index.css";

useProvidersStore.setState({ loaded: true });
useConnectionsStore.setState({
  activeId: "mysql",
  connections: [
    { id: "mysql", name: "MySQL", kind: "mysql", connectionString: "mysql://127.0.0.1/first" },
    {
      id: "other",
      name: "Other",
      kind: "postgres",
      connectionString: "postgresql://127.0.0.1/first",
    },
  ],
});
useDbSelectionStore.getState().setDatabase("mysql", "first");

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

function Fixture() {
  const [schema, setSchema] = useState("first");
  const [table, setTable] = useState("items");
  return (
    <main className="flex h-dvh flex-col">
      <nav className="flex flex-wrap gap-3 p-3 text-xs">
        <button type="button" onClick={() => setSchema("first")}>
          First schema
        </button>
        <button type="button" onClick={() => setSchema("second")}>
          Second schema
        </button>
        <button type="button" onClick={() => setTable("legacy")}>
          Legacy metadata
        </button>
        <button
          type="button"
          onClick={() => useDbSelectionStore.getState().setDatabase("mysql", "second")}
        >
          Other database
        </button>
        <button type="button" onClick={() => useConnectionsStore.getState().setActiveId("other")}>
          Other provider
        </button>
      </nav>
      <TableColumnsList schema={schema} table={table} editable />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
createRoot(root).render(
  <QueryClientProvider client={client}>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </QueryClientProvider>,
);
