import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { DataTable } from "../../src/features/table/data-table";
import { useConnectionsStore } from "../../src/lib/connections";
import "../../src/index.css";

useConnectionsStore.setState({
  activeId: "d",
  connections: [{ id: "d", name: "Local", kind: "postgres", connectionString: "postgresql://localhost/shop", sslMode: "disable" }],
});
const client = new QueryClient();
const first = ["Anna", "Ben", "Clara", "David", "Elif", "Finn", "Greta", "Hannes", "Ida", "Jonas", "Klara", "Luca"];
const last = ["Schmidt", "Müller", "Weber", "Fischer", "Wagner", "Becker", "Hoffmann", "Koch"];
const cities = ["Berlin", "Hamburg", "München", "Köln", "Leipzig", "Dresden"];
const status = ["paid", "pending", "shipped", "refunded", "cancelled"];
const cols = ["id", "uuid", "customer_id", "first_name", "last_name", "email", "status", "total_amount", "currency", "item_count", "is_gift", "city", "country_code", "notes", "metadata", "created_at", "updated_at", "shipped_at"];
const rows = Array.from({ length: 40 }, (_, i) => ({
  __ctid__: `(0,${i + 1})`,
  id: 10241 + i,
  uuid: `${(0x3f2a91c4 + i * 7919).toString(16)}-8b1e-4c2a-9f3d-${(0x1a2b3c4d5e6f + i * 104729).toString(16).slice(0, 12)}`,
  customer_id: 500 + ((i * 37) % 120),
  first_name: first[i % first.length],
  last_name: last[(i * 3) % last.length],
  email: `${first[i % first.length].toLowerCase()}.${last[(i * 3) % last.length].toLowerCase()}@example.de`,
  status: status[(i * 7) % status.length],
  total_amount: ((i * 1373) % 50000) / 100 + 9.9,
  currency: "EUR",
  item_count: 1 + ((i * 5) % 9),
  is_gift: i % 4 === 0,
  city: cities[i % cities.length],
  country_code: "DE",
  notes: i % 3 === 0 ? null : i % 3 === 1 ? "Bitte an der Hintertür abgeben, Klingel defekt" : "Express",
  metadata: { source: i % 2 ? "web" : "app", campaign: "autumn-2026", device: "ios" },
  created_at: `2026-09-${String(1 + (i % 28)).padStart(2, "0")} 14:${String(i % 60).padStart(2, "0")}:12.381+02`,
  updated_at: `2026-10-0${1 + (i % 7)} 09:${String((i * 7) % 60).padStart(2, "0")}:44.120+02`,
  shipped_at: i % 5 === 1 ? null : `2026-10-0${1 + (i % 7)} 16:20:00+02`,
}));
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="dark">
    <HotkeysProvider>
      <QueryClientProvider client={client}>
        <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
          <DataTable className="h-full min-h-0 flex-1" columns={cols} data={rows} emptyMessage="Keine Daten" sorting={[]} onSortingChange={() => {}} currentSchema="public" currentTable="orders"
            columnDetails={cols.map((name, i) => ({ name, data_type: ["bigint","uuid","integer","text","text","text","order_status","numeric","char","integer","boolean","text","char","text","jsonb","timestamptz","timestamptz","timestamptz"][i], is_nullable: i > 2, column_default: null, is_primary_key: i === 0, ordinal_position: i + 1, character_maximum_length: null }))} />
        </div>
      </QueryClientProvider>
    </HotkeysProvider>
  </ThemeProvider>,
);
