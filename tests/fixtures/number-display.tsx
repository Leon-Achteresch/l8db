import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryResultTable } from "@/features/query/query-result-table";
import { DataTable } from "@/features/table/data-table";
import type { TableRow } from "@/features/table/data-table-types";
import { TableActionsMenu } from "@/features/table/table-view/table-export-menu";
import { TimestampDisplayMenu } from "@/features/table/timestamp-display-menu";
import type { DetailedColumnInfo, QueryResult } from "@/lib/db";
import "@/index.css";

const columns = ["big", "amount", "reference"];
const details: DetailedColumnInfo[] = columns.map((name, i) => ({
  name,
  data_type: ["bigint", "numeric(42,22)", "text"][i],
  is_nullable: true,
  column_default: null,
  is_primary_key: false,
  ordinal_position: i + 1,
  character_maximum_length: null,
}));
const integer = "9007199254740993";
const fraction = "-1234.5678901234567890123456";

const query: QueryResult = {
  columns: ["actual", "unknown", "blank"],
  rows: [{ actual: 12345.5, unknown: integer, blank: null }],
  rows_affected: null,
  execution_time_ms: 1,
};
const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });

function Fixture() {
  const [rows, setRows] = useState<TableRow[]>([
    { __ctid__: "(0,1)", big: integer, amount: "1234.5", reference: "0012345" },
    { __ctid__: "(0,2)", big: null, amount: fraction, reference: "raw" },
  ]);
  const [save, setSave] = useState("");
  return (
    <main className="flex flex-col gap-4 p-3">
      <section aria-label="Tabelle" className="flex h-64 min-w-0 flex-col">
        <div className="flex justify-end">
          <TableActionsMenu>
            <TimestampDisplayMenu />
          </TableActionsMenu>
        </div>
        <DataTable
          className="min-h-0 flex-1"
          columns={columns}
          columnDetails={details}
          data={rows}
          emptyMessage="Keine Daten"
          sorting={[]}
          onSortingChange={() => {}}
          onSaveRow={async (ctid, updates, oldValues) => {
            setSave(JSON.stringify({ ctid, updates, oldValues }));
            setRows((previous) =>
              previous.map((row) => (row.__ctid__ === ctid ? { ...row, ...updates } : row)),
            );
          }}
        />
      </section>
      <output aria-label="Test-Speicherauftrag">{save}</output>
      <section aria-label="Query-Ergebnis" className="h-64 min-w-0">
        <QueryResultTable result={query} isLoading={false} error={null} />
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <ThemeProvider attribute="class" defaultTheme="system">
      <QueryClientProvider client={client}>
        <HotkeysProvider>
          <Fixture />
        </HotkeysProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
