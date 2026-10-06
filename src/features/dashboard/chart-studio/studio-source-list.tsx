import { EyeIcon, PlusIcon, SearchIcon, SparklesIcon, Table2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { likelyRelated } from "@/lib/dashboards";
import { useTablesQuery, useViewsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SOURCE_TABLE_MIME } from "./studio-model";

export interface SourceTable {
  schema: string;
  table: string;
  view: boolean;
}

export function StudioSourceList({
  hasBase,
  onCanvas,
  columnNames,
  fkTables,
  onPick,
}: {
  hasBase: boolean;
  onCanvas: Set<string>;
  columnNames: string[];
  fkTables: Set<string>;
  onPick: (source: SourceTable) => void;
}) {
  const [search, setSearch] = useState("");
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const sources = useMemo<SourceTable[]>(
    () => [
      ...(tables.data ?? []).map((t) => ({ schema: t.schema, table: t.name, view: false })),
      ...(views.data ?? []).map((t) => ({ schema: t.schema, table: t.name, view: true })),
    ],
    [tables.data, views.data],
  );
  const related = useMemo(
    () => new Set([...likelyRelated(columnNames, sources), ...fkTables]),
    [columnNames, sources, fkTables],
  );
  const needle = search.trim().toLowerCase();
  const found = sources.filter((s) => `${s.schema}.${s.table}`.toLowerCase().includes(needle));
  const key = (s: SourceTable) => `${s.schema}.${s.table}`;
  const suggested = hasBase
    ? found.filter((s) => related.has(key(s)) && !onCanvas.has(key(s)))
    : [];
  const rest = found.filter((s) => !suggested.includes(s));
  const loading = tables.isLoading || views.isLoading;

  const row = (source: SourceTable, hint?: boolean) => {
    const placed = onCanvas.has(key(source));
    const Icon = source.view ? EyeIcon : Table2Icon;
    return (
      <li key={`${source.view ? "v" : "t"}:${key(source)}`}>
        <button
          type="button"
          draggable={!placed}
          disabled={placed}
          onDragStart={(event) => {
            event.dataTransfer.setData(SOURCE_TABLE_MIME, JSON.stringify(source));
            event.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onPick(source)}
          title={
            placed
              ? "Schon im Datenmodell"
              : hasBase
                ? `${source.table} verbinden`
                : `Mit ${source.table} starten`
          }
          className={cn(
            "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50",
            hint && "bg-primary/5 hover:bg-primary/10",
          )}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {source.schema && <span className="text-muted-foreground">{source.schema}.</span>}
            {source.table}
          </span>
          {placed ? (
            <span className="text-[10px] text-muted-foreground">im Modell</span>
          ) : (
            <PlusIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          )}
        </button>
      </li>
    );
  };

  return (
    <aside
      aria-label="Datenquellen"
      className="flex min-h-0 flex-col gap-3 border-r bg-muted/25 p-3"
    >
      <div>
        <h2 className="text-xs font-semibold">
          {hasBase ? "Tabelle verbinden" : "Womit startest du?"}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {hasBase
            ? "Klicken oder ins Datenmodell ziehen"
            : "Wähle die Tabelle mit deinen Kennzahlen"}
        </p>
      </div>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
        <Input
          aria-label="Tabellen suchen"
          placeholder="Tabelle suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 bg-background pl-8 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {suggested.length > 0 && (
          <section aria-label="Passende Tabellen">
            <h3 className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wide text-primary uppercase">
              <SparklesIcon className="size-3" /> Passt zu deinen Daten
            </h3>
            <ul className="space-y-0.5">{suggested.map((s) => row(s, true))}</ul>
          </section>
        )}
        <section aria-label="Alle Tabellen">
          {suggested.length > 0 && (
            <h3 className="mb-1 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              Alle
            </h3>
          )}
          <ul className="space-y-0.5">
            {loading &&
              [0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="mx-2 my-1.5 h-4 animate-pulse rounded bg-muted" />
              ))}
            {rest.map((s) => row(s))}
          </ul>
          {!loading && found.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Keine Tabelle gefunden.
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
