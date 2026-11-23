import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataTable } from "@/features/table/data-table";
import type { TableRow } from "@/features/table/data-table-types";
import type { DetailedColumnInfo } from "@/lib/db";
import { useQueryQolSettings } from "@/lib/query-qol-settings";
import "@/index.css";

const fields = [
  "Name",
  "Fehlend",
  "Leer",
  "Nullwert",
  "Aktiv",
  "Genauer Betrag",
  "Zeitpunkt",
  "Notiz",
  "Struktur",
  ...Array.from({ length: 1191 }, (_, index) => `Feld ${index + 10}`),
];
const types: Record<string, string> = {
  "Genauer Betrag": "numeric",
  Zeitpunkt: "timestamptz",
  Aktiv: "boolean",
  Struktur: "jsonb",
};
const columns: DetailedColumnInfo[] = fields.map((name, index) => ({
  name,
  data_type: types[name] ?? "text",
  is_nullable: true,
  column_default: null,
  is_primary_key: false,
  ordinal_position: index + 1,
  character_maximum_length: null,
}));
const rowA: TableRow = {
  __ctid__: "(0,1)",
  Name: "Inventur Nord",
  Leer: "",
  Nullwert: null,
  Aktiv: false,
  "Genauer Betrag": "9007199254740993.125",
  Zeitpunkt: "2026-11-18T12:34:56+02:00",
  Notiz: "Zeile eins\nZeile zwei",
  Struktur: { region: "Nord", lagersaldo: [4, 8] },
  "Feld 10": "x".repeat(50_000),
  "Feld 1200": "Letztes Feld · Nord",
};
const rowB: TableRow = { Name: "Inventur Süd", "Feld 1200": "Letztes Feld · Süd" };
const nextTable: TableRow[] = [{ Name: "Katalog West" }];
const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });

useQueryQolSettings.getState().setNumbers({ mode: "grouped", minimumFractionDigits: 2 });
useQueryQolSettings.getState().setTimestamps({ mode: "utc", precision: "seconds" });

function Fixture() {
  const [data, setData] = useState([rowA, rowB]);
  const [scope, setScope] = useState("inventory");
  useEffect(() => {
    const change = (event: Event) => {
      const scenario = (event as CustomEvent<string>).detail;
      if (scenario === "replace-row") setData([{ ...rowA, Name: "Inventur Nord neu" }, rowB]);
      if (scenario === "switch-table") {
        setScope("catalog");
        setData(nextTable);
      }
    };
    window.addEventListener("record-fixture", change);
    return () => window.removeEventListener("record-fixture", change);
  }, []);
  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden p-3">
      <DataTable
        key={scope}
        stateKey={scope}
        currentSchema="public"
        currentTable={scope}
        recordView
        autoSelectFirstCell
        rowOffset={scope === "inventory" ? 40 : 0}
        columns={fields}
        columnDetails={columns}
        data={data}
        emptyMessage="Keine Daten"
        sorting={[]}
        onSortingChange={() => {}}
      />
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <ThemeProvider attribute="class" defaultTheme="system">
      <QueryClientProvider client={client}>
        <HotkeysProvider>
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </HotkeysProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
