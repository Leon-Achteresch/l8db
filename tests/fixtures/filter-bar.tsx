import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsTableAppearance } from "../../src/features/settings/settings-table-appearance";
import { DataTable } from "../../src/features/table/data-table";
import { TableFilterBar } from "../../src/features/table/table-filter-bar";
import { useConnectionsStore } from "../../src/lib/connections";
import type { DatabaseKind } from "../../src/lib/db";
import { normalizeFilterBarStyle } from "../../src/lib/filter-bar-style";
import { FALLBACK_PROVIDERS, useProvidersStore } from "../../src/lib/providers";
import { useSettingsStore } from "../../src/lib/settings";
import { compileFilterConditions } from "../../src/lib/sql-filter";
import { useTableViewStateStore } from "../../src/lib/table-view-state";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
const kind = (params.get("kind") ?? "postgres") as DatabaseKind;
useSettingsStore.getState().setFilterBarStyle(normalizeFilterBarStyle(params.get("style")));
document.documentElement.classList.toggle("dark", params.get("theme") !== "light");

const columns = ["id", "message_id", "status", "tokens", "created_at"];
const columnDetails = [
  { name: "id", data_type: "int4" },
  { name: "message_id", data_type: "text" },
  { name: "status", data_type: "varchar" },
  { name: "tokens", data_type: "int4" },
  { name: "created_at", data_type: "timestamptz" },
].map((column, index) => ({
  ...column,
  is_nullable: true,
  column_default: null,
  is_primary_key: column.name === "id",
  ordinal_position: index + 1,
  character_maximum_length: null,
  comment: null,
}));
const data = [
  {
    id: 1,
    message_id: "msg_da180cd590018u8xH5k20o8i24",
    status: "ok",
    tokens: 1204,
    created_at: "2026-10-16 14:02",
  },
  {
    id: 2,
    message_id: "msg_da17f2b1c9aa01kqP2m7c1z",
    status: "error",
    tokens: 312,
    created_at: "2026-10-16 13:58",
  },
  {
    id: 3,
    message_id: "msg_da17e90f44b2c7mzQ8v3n0d",
    status: "ok",
    tokens: 5880,
    created_at: "2026-10-15 09:41",
  },
  {
    id: 4,
    message_id: "msg_da17b0e3f15a9wtrN6d2k8s",
    status: "error",
    tokens: 4410,
    created_at: "2026-10-13 11:07",
  },
];

useProvidersStore.setState({
  providers: [
    {
      ...FALLBACK_PROVIDERS[0],
      id: kind,
      kind,
      capabilities: {
        ...FALLBACK_PROVIDERS[0].capabilities,
        query_language:
          kind === "mongodb"
            ? "json"
            : kind === "redis"
              ? "redis"
              : kind === "cassandra"
                ? "cql"
                : "sql",
      },
    },
  ],
});
useConnectionsStore.setState({
  activeId: "filter-bar-test",
  connections: [
    {
      id: "filter-bar-test",
      name: "Filter bar test",
      kind,
      connectionString: "postgresql://localhost/filter_bar_test",
      sslMode: "disable",
    },
  ],
});

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const late = params.has("late");
const lateCondition = { id: "late", column: "created_at", operator: "eq", value: "2026-10-01" };
if (late)
  useTableViewStateStore.getState().patch("filter-bar", {
    filterMode: "simple",
    filterConditions: [lateCondition],
    filterCombinator: "AND",
  });

function App() {
  const [activeFilter, setActiveFilter] = useState(() =>
    late ? compileFilterConditions([lateCondition], "AND", kind, columnDetails) : "",
  );
  const [ready, setReady] = useState(!late);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(timer);
  }, []);
  const [raw, setRaw] = useState(false);
  const [applies, setApplies] = useState(0);
  const apply = (where: string, isRaw: boolean) => {
    setActiveFilter(where);
    setRaw(isRaw);
    setApplies((count) => count + 1);
  };
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {params.has("settings") ? (
        <div className="@container p-4">
          <SettingsTableAppearance />
        </div>
      ) : null}
      <TableFilterBar
        stateKey="filter-bar"
        columns={ready ? columns : []}
        columnDetails={ready ? columnDetails : undefined}
        activeFilter={activeFilter}
        onApply={apply}
      />
      <div className="flex gap-4 px-3 py-1 font-mono text-[11px] text-muted-foreground">
        <output aria-label="Applied filter">{activeFilter}</output>
        <output aria-label="Raw SQL">{String(raw)}</output>
        <output aria-label="Apply count">{applies}</output>
        <button type="button" onClick={() => apply("", false)}>
          Extern zurücksetzen
        </button>
      </div>
      <DataTable
        stateKey="filter-bar"
        className="min-h-0 flex-1"
        columns={columns}
        data={data}
        emptyMessage="Keine Daten"
        sorting={[]}
        onSortingChange={() => {}}
        onApplyFilter={apply}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <ThemeProvider attribute="class" defaultTheme="dark">
      <HotkeysProvider>
        <QueryClientProvider client={client}>
          <App />
        </QueryClientProvider>
      </HotkeysProvider>
    </ThemeProvider>,
  );
