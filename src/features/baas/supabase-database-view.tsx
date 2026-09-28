import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { supabaseTableColumns, supabaseTableRows, supabaseTables } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SupabaseDatabaseView({ reference }: { reference: string }) {
  const [tableOffset, setTableOffset] = useState(0);
  const [rowOffset, setRowOffset] = useState(0);
  const [selected, setSelected] = useState<{ schema: string; name: string } | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.database");
  const tables = useQuery({
    queryKey: ["supabase", reference, "tables", tableOffset],
    queryFn: () => supabaseTables(reference, tableOffset),
  });
  const table =
    tables.data?.tables.find(
      (entry) => entry.schema === selected?.schema && entry.name === selected?.name,
    ) ?? tables.data?.tables[0];
  const columns = useQuery({
    queryKey: ["supabase", reference, "columns", table?.schema, table?.name],
    queryFn: () => {
      if (!table) throw new Error("Keine Tabelle gewählt.");
      return supabaseTableColumns(reference, table.schema, table.name);
    },
    enabled: Boolean(table),
  });
  const rows = useQuery({
    queryKey: ["supabase", reference, "table-rows", table?.schema, table?.name, rowOffset],
    queryFn: () => {
      if (!table) throw new Error("Keine Tabelle gewählt.");
      return supabaseTableRows(reference, table.schema, table.name, rowOffset);
    },
    enabled: Boolean(table),
  });
  const columnNames =
    columns.data?.map((column) => column.name) ?? Object.keys(rows.data?.rows[0]?.values ?? {});

  function selectTable(schema: string, name: string) {
    setSelected({ schema, name });
    setRowOffset(0);
  }

  function changeTablePage(nextOffset: number) {
    setTableOffset(nextOffset);
    setRowOffset(0);
    setSelected(null);
  }

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div ref={feature.ref} className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Datenbanktabellen</h3>
          {feature.isNew && <NewBadge />}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Datenbanktabellen aktualisieren"
          onClick={() => void tables.refetch()}
          disabled={tables.isFetching}
        >
          <RefreshCw className={`size-3.5 ${tables.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Lesende Vorschau über die Supabase Management API. Das Zugangstoken benötigt Database: Read.
      </p>
      {tables.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Tabellen werden geladen…</p>
      ) : tables.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(tables.error)}
        </p>
      ) : tables.data.tables.length === 0 && tableOffset === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">Keine sichtbaren Tabellen vorhanden.</p>
      ) : (
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="max-h-72 overflow-auto rounded-lg border">
              {tables.data.tables.map((entry) => (
                <button
                  key={`${entry.schema}.${entry.name}`}
                  type="button"
                  aria-pressed={table?.schema === entry.schema && table.name === entry.name}
                  onClick={() => selectTable(entry.schema, entry.name)}
                  className={`block w-full border-b px-3 py-2 text-left text-xs last:border-b-0 ${table?.schema === entry.schema && table.name === entry.name ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                >
                  <span className="block truncate font-mono">{entry.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {entry.schema} · {entry.kind}
                  </span>
                </button>
              ))}
            </div>
            {(tableOffset > 0 || tables.data.has_more) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Vorherige Tabellen"
                  disabled={tableOffset === 0}
                  onClick={() => changeTablePage(Math.max(0, tableOffset - 100))}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {tableOffset + 1}–{tableOffset + tables.data.tables.length}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Weitere Tabellen"
                  disabled={!tables.data.has_more}
                  onClick={() => changeTablePage(tableOffset + 100)}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
          {table && (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate font-mono text-xs font-medium">
                  {table.schema}.{table.name}
                </p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Tabellenzeilen aktualisieren"
                  onClick={() => void rows.refetch()}
                  disabled={rows.isFetching}
                >
                  <RefreshCw className={`size-3.5 ${rows.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
              {columns.isError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  Spalten konnten nicht geladen werden: {String(columns.error)}
                </p>
              )}
              {rows.isPending ? (
                <p className="mt-4 text-xs text-muted-foreground">Zeilen werden geladen…</p>
              ) : rows.isError ? (
                <p role="alert" className="mt-4 text-xs text-destructive">
                  {String(rows.error)}
                </p>
              ) : (
                <>
                  <div className="mt-3 overflow-x-auto rounded-lg border">
                    <table className="min-w-full text-left text-xs">
                      <caption className="sr-only">
                        Vorschau der Tabelle {table.schema}.{table.name}
                      </caption>
                      <thead className="bg-muted/50">
                        <tr>
                          {columnNames.map((name) => (
                            <th
                              key={name}
                              scope="col"
                              className="whitespace-nowrap px-3 py-2 font-medium"
                            >
                              {name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.data.rows.map((row) => (
                          <tr key={row.ordinal} className="border-t">
                            {columnNames.map((name) => (
                              <td key={name} className="min-w-32 max-w-64 px-3 py-2 align-top">
                                <div className="max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono">
                                  {displayCell(row.values[name])}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.data.rows.length === 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Keine Zeilen auf dieser Seite.
                    </p>
                  )}
                  {(rowOffset > 0 || rows.data.has_more) && (
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={rowOffset === 0}
                        onClick={() => setRowOffset((value) => Math.max(0, value - 50))}
                      >
                        <ChevronLeft className="size-3.5" /> Zurück
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        {rowOffset + 1}–{rowOffset + rows.data.rows.length}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!rows.data.has_more}
                        onClick={() => setRowOffset((value) => value + 50)}
                      >
                        Weiter <ChevronRight className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
