import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryResultTable } from "../../src/features/query/query-result-table";
import { SettingsDataTab } from "../../src/features/settings/settings-data-tab";
import { DataTable } from "../../src/features/table/data-table";
import { TableFilterPanel } from "../../src/features/table/table-filter-panel";
import { useConnectionsStore } from "../../src/lib/connections";
import type { DatabaseKind } from "../../src/lib/db";
import { FALLBACK_PROVIDERS, useProvidersStore } from "../../src/lib/providers";
import { redisKeyFilter } from "../../src/lib/redis-commands";
import "../../src/index.css";

const requestedKind = new URLSearchParams(location.search).get("kind");
const kind: DatabaseKind = [
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "mongodb",
  "redis",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
].includes(requestedKind ?? "")
  ? (requestedKind as DatabaseKind)
  : "postgres";
const columns = kind === "redis" ? ["key", "id"] : ["name", "id"];
const data = kind === "redis" ? [{ key: "user:1", id: "1" }] : [{ name: "Berlin", id: "1" }];
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
  activeId: "filter-test",
  connections: [
    {
      id: "filter-test",
      name: "Filter test",
      kind,
      connectionString: "postgresql://localhost/filter_test",
      sslMode: "disable",
    },
  ],
});

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function App() {
  const [activeFilter, setActiveFilter] = useState("");
  const [applies, setApplies] = useState(0);
  const [raw, setRaw] = useState(false);
  const apply = (where: string, isRaw: boolean) => {
    setActiveFilter(where);
    setApplies((count) => count + 1);
    setRaw(isRaw);
  };
  if (new URLSearchParams(location.search).has("result")) {
    return (
      <div className="h-dvh">
        <QueryResultTable
          result={{
            columns: ["name"],
            rows: [{ name: "Berlin" }, { name: "Hamburg" }, { name: "a,b" }, { name: null }],
            rows_affected: null,
            execution_time_ms: 1,
          }}
          isLoading={false}
          error={null}
        />
      </div>
    );
  }
  return (
    <div className="flex h-dvh flex-col p-4">
      <details>
        <summary>Einstellungen</summary>
        <SettingsDataTab />
      </details>
      <TableFilterPanel columns={columns} activeFilter={activeFilter} onApply={apply} />
      <output aria-label="Applied filter">{activeFilter}</output>
      <output aria-label="Apply count">{applies}</output>
      <output aria-label="Raw SQL">{String(raw)}</output>
      <DataTable
        className="min-h-0 flex-1"
        columns={columns}
        data={data}
        compileColumnFilter={kind === "redis" ? redisKeyFilter : undefined}
        filterPrefix={kind === "redis" ? "MATCH" : kind === "mongodb" ? "JSON" : undefined}
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
    <HotkeysProvider>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </HotkeysProvider>,
  );
