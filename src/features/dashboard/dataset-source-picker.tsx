import { DatabaseIcon, SearchIcon, TableIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryErrorMessage } from "@/lib/connection-url";
import { useTablesQuery, useViewsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function DatasetSourcePicker({
  schema,
  table,
  onChange,
}: {
  schema: string;
  table: string;
  onChange: (schema: string, table: string) => void;
}) {
  const [search, setSearch] = useState("");
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const sources = [
    ...(views.data ?? []).map((v) => ({ ...v, kind: "View" })),
    ...(tables.data ?? []).map((t) => ({ ...t, kind: "Tabelle" })),
  ];
  const filtered = sources.filter((s) =>
    `${s.schema}.${s.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const error = tables.error || views.error;
  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label="Tabellen und Views suchen"
          placeholder="Tabelle oder View suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      {error && (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{queryErrorMessage(error)}</p>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void tables.refetch();
              void views.refetch();
            }}
          >
            Quellen erneut laden
          </Button>
        </div>
      )}
      {tables.isFetching && (
        <p role="status" className="text-xs text-muted-foreground">
          Quellen werden geladen…
        </p>
      )}
      <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
        {filtered.map((source) => (
          <button
            key={`${source.kind}:${source.schema}.${source.name}`}
            type="button"
            aria-pressed={source.schema === schema && source.name === table}
            onClick={() => onChange(source.schema, source.name)}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
              source.schema === schema && source.name === table && "bg-primary/10",
            )}
          >
            {source.kind === "View" ? (
              <DatabaseIcon className="size-4 text-muted-foreground" />
            ) : (
              <TableIcon className="size-4 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{source.name}</span>
              <span className="text-xs text-muted-foreground">
                {source.schema || "Standard"} · {source.kind}
              </span>
            </span>
            {source.schema === schema && source.name === table && (
              <span className="text-xs font-medium">Ausgewählt</span>
            )}
          </button>
        ))}
        {!tables.isFetching && !filtered.length && (
          <p className="p-4 text-xs text-muted-foreground">
            {search
              ? "Keine passende Quelle. Versuche einen anderen Suchbegriff."
              : "Keine Tabellen oder Views im aktiven Schema vorhanden."}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Views sind bereits vorbereitete Daten. Du kannst sie direkt verwenden und für jeden Chart
        andere Kennzahlen auswählen.
      </p>
    </div>
  );
}
