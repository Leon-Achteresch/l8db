import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryResultTable } from "@/features/query/query-result-table";
import { DataTable } from "@/features/table/data-table";
import { TableActionsMenu } from "@/features/table/table-view/table-export-menu";
import { TimestampDisplayMenu } from "@/features/table/timestamp-display-menu";
import { useConnectionsStore } from "@/lib/connections";
import type { DetailedColumnInfo, QueryResult } from "@/lib/db";
import { useProvidersStore } from "@/lib/providers";
import { useTableViewStateStore } from "@/lib/table-view-state";
import { supportsBusinessTimestamp } from "@/lib/timestamp-display";
import "@/index.css";

const provider = new URLSearchParams(location.search).has("mysql") ? "mysql" : "postgres";
useProvidersStore.setState({ loaded: true });
useConnectionsStore.setState({
  activeId: "time-fixture",
  connections: [
    {
      id: "time-fixture",
      kind: provider,
      name: "Zeitfixture",
      connectionString: `${provider === "postgres" ? "postgresql" : "mysql"}://127.0.0.1/fixture`,
      sslMode: "disable",
    },
  ],
});

const columns = ["event_at", "wall_time", "text_like"];
const details: DetailedColumnInfo[] = columns.map((name, index) => ({
  name,
  data_type: ["timestamp(6) with time zone", "timestamp without time zone", "text"][index],
  is_nullable: true,
  column_default: null,
  is_primary_key: false,
  ordinal_position: index + 1,
  character_maximum_length: null,
}));
const instants = [
  "2026-03-08T06:59:59.123456+00:00",
  "2026-03-08T07:00:00.234560+00:00",
  "2026-11-01T05:30:00.999999Z",
  "2026-11-01T06:30:00.000001Z",
  null,
];
const data = instants.map((value, index) => ({
  __ctid__: `(0,${index + 1})`,
  event_at: value,
  wall_time: value ? "2026-11-01 01:30:00" : null,
  text_like: value,
}));
const query: QueryResult = {
  columns: ["unknown_type"],
  rows: [{ unknown_type: instants[0] }],
  rows_affected: null,
  execution_time_ms: 1,
};
const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
useTableViewStateStore.getState().patch("time-fixture", {
  columnSizing: { event_at: 315, wall_time: 190, text_like: 315 },
});

function Fixture() {
  const [save, setSave] = useState("");
  return (
    <main className="flex flex-col gap-4 p-3">
      <section aria-label="Tabelle" className="flex h-72 min-w-0 flex-col">
        <div className="flex justify-end">
          <TableActionsMenu
            businessTimeZone={details.some((item) =>
              supportsBusinessTimestamp(provider, item.data_type),
            )}
          >
            <TimestampDisplayMenu />
          </TableActionsMenu>
        </div>
        <DataTable
          className="min-h-0 flex-1"
          columns={columns}
          columnDetails={details}
          stateKey="time-fixture"
          data={data}
          emptyMessage="Keine Daten"
          sorting={[]}
          onSortingChange={() => {}}
          onSaveRow={async (ctid, updates, oldValues) =>
            setSave(JSON.stringify({ ctid, updates, oldValues }))
          }
        />
      </section>
      <output aria-label="Test-Speicherauftrag">{save}</output>
      <section aria-label="Query-Ergebnis" className="h-40 min-w-0">
        <QueryResultTable result={query} isLoading={false} error={null} />
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <ThemeProvider attribute="class" defaultTheme="system">
    <QueryClientProvider client={client}>
      <HotkeysProvider>
        <Fixture />
      </HotkeysProvider>
    </QueryClientProvider>
  </ThemeProvider>,
);
