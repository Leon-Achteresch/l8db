import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "../../src/features/table/data-table";
import { useConnectionsStore } from "../../src/lib/connections";
import "../../src/index.css";

useConnectionsStore.setState({
  activeId: "edit-test",
  connections: [
    {
      id: "edit-test",
      name: "Local development",
      kind: "postgres",
      connectionString: "postgresql://localhost/edit_test",
      sslMode: "disable",
    },
  ],
});

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function App() {
  const [rows, setRows] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      __ctid__: `(0,${i + 1})`,
      id: String(i + 1),
      email: `user${i + 1}@example.test`,
      city: ["Berlin", "Hamburg", "Köln"][i % 3],
    })),
  );
  return (
    <div style={{ height: "100dvh", padding: 16, display: "flex", flexDirection: "column" }}>
      <DataTable
        className="h-full min-h-0 flex-1"
        columns={["id", "email", "city"]}
        data={rows}
        emptyMessage="Keine Daten"
        sorting={[]}
        onSortingChange={() => {}}
        currentSchema="public"
        currentTable="customers"
        onSaveRow={async (ctid, updates) => {
          window.testSaves.push({ ctid, updates });
          setRows((prev) =>
            prev.map((r) => (r.__ctid__ === ctid ? { ...r, ...updates } : r)),
          );
        }}
      />
    </div>
  );
}

window.testSaves = [];
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="dark">
    <HotkeysProvider>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </HotkeysProvider>
  </ThemeProvider>,
);
