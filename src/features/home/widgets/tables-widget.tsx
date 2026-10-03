import { Link } from "@tanstack/react-router";
import { Plus, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import { useActiveSchema } from "@/lib/db-selection";
import { useTablesQuery } from "@/lib/queries";
import { DashboardTableList } from "../dashboard-table-list";

const TABLE_LIST_LIMIT = 50;

export function TablesWidget() {
  const schema = useActiveSchema();
  const tables = useTablesQuery();
  const [search, setSearch] = useState("");
  const matching = useMemo(() => {
    if (!tables.data) return [];
    if (!search) return tables.data;
    const needle = search.toLowerCase();
    return tables.data.filter((table) => table.name.toLowerCase().includes(needle));
  }, [tables.data, search]);
  const filtered = matching.slice(0, TABLE_LIST_LIMIT);

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-sm font-semibold">
          Tabellen{" "}
          <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
            {schema}
          </span>
        </h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
          <Input
            className="h-7 w-44 rounded-lg pl-8 text-xs"
            aria-label="Tabellen in der Übersicht suchen"
            placeholder="Tabelle suchen…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {tables.isPending || (tables.isError && !queryErrorMessage(tables.error)) ? (
        <div className="space-y-4 p-5">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-7 w-full" />
          ))}
        </div>
      ) : tables.isError ? (
        <div className="p-5">
          <p role="alert" className="text-xs leading-relaxed text-destructive">
            {queryErrorMessage(tables.error)}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void tables.refetch()}
          >
            Erneut versuchen
          </Button>
        </div>
      ) : filtered.length ? (
        <DashboardTableList tables={filtered} hidden={matching.length - filtered.length} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-8 text-center">
          <Table2 className="mx-auto mb-3 size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {search
              ? "Keine passende Tabelle gefunden."
              : "Dieses Schema enthält noch keine Tabellen."}
          </p>
          {!search && (
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link to="/create-table">
                <Plus className="size-3" />
                Tabelle erstellen
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
