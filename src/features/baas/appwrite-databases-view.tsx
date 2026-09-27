import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, RefreshCw, Table2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { appwriteDatabases, appwriteTables } from "@/lib/db";

export function AppwriteDatabasesView({ id }: { id: string }) {
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const [databaseOffset, setDatabaseOffset] = useState(0);
  const [tableOffset, setTableOffset] = useState(0);
  const databases = useQuery({
    queryKey: ["appwrite", id, "databases", databaseOffset],
    queryFn: () => appwriteDatabases(id, databaseOffset),
  });
  const selected =
    databases.data?.items.find((item) => item.id === databaseId) ?? databases.data?.items[0];
  const tables = useQuery({
    queryKey: ["appwrite", id, "tables", selected?.id, tableOffset],
    queryFn: () => {
      if (!selected) throw new Error("Keine Datenbank gewählt.");
      return appwriteTables(id, selected.id, tableOffset);
    },
    enabled: Boolean(selected),
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Database className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">TablesDB</h3>
        {databases.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {databases.data.total} Datenbanken
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="TablesDB aktualisieren"
          onClick={() => void databases.refetch()}
          disabled={databases.isFetching}
        >
          <RefreshCw className={`size-3.5 ${databases.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {databases.isPending ? (
        <p className="mt-5 text-xs text-muted-foreground">Datenbanken werden geladen…</p>
      ) : databases.isError ? (
        <p role="alert" className="mt-5 text-xs text-destructive">
          {String(databases.error)}
        </p>
      ) : databases.data.items.length === 0 ? (
        <p className="mt-5 text-xs text-muted-foreground">Keine Datenbanken vorhanden.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {databases.data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected?.id === item.id}
                onClick={() => {
                  setDatabaseId(item.id);
                  setTableOffset(0);
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${selected?.id === item.id ? "border-primary/50 bg-primary/10" : "bg-background hover:bg-muted"}`}
              >
                {item.name}
              </button>
            ))}
          </div>
          {databaseOffset > 0 ||
          databaseOffset + databases.data.items.length < databases.data.total ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Vorherige Datenbanken"
                disabled={databaseOffset === 0}
                onClick={() => setDatabaseOffset((value) => Math.max(0, value - 100))}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Weitere Datenbanken"
                disabled={databaseOffset + databases.data.items.length >= databases.data.total}
                onClick={() => {
                  setDatabaseOffset((value) => value + 100);
                  setDatabaseId(null);
                  setTableOffset(0);
                }}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ) : null}
          <div className="mt-5 border-t pt-4">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Table2 className="size-3.5 text-muted-foreground" /> Tabellen in {selected?.name}
              {tables.data && (
                <span className="ml-auto text-muted-foreground">{tables.data.total}</span>
              )}
            </div>
            {tables.isPending ? (
              <p className="mt-4 text-xs text-muted-foreground">Tabellen werden geladen…</p>
            ) : tables.isError ? (
              <p role="alert" className="mt-4 text-xs text-destructive">
                {String(tables.error)}
              </p>
            ) : tables.data.items.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">Keine Tabellen vorhanden.</p>
            ) : (
              <div className="mt-3 divide-y">
                {tables.data.items.map((table) => (
                  <div key={table.id} className="py-2 text-xs">
                    <p className="truncate font-medium">{table.name}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {table.id}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {tables.data &&
              (tableOffset > 0 || tableOffset + tables.data.items.length < tables.data.total) && (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Vorherige Tabellen"
                    disabled={tableOffset === 0}
                    onClick={() => setTableOffset((value) => Math.max(0, value - 100))}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Weitere Tabellen"
                    disabled={tableOffset + tables.data.items.length >= tables.data.total}
                    onClick={() => setTableOffset((value) => value + 100)}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              )}
          </div>
        </>
      )}
    </section>
  );
}
