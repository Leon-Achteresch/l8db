import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type StudioTable, studioTablesList } from "@/lib/db/supabase-studio-tables";
import { cn } from "@/lib/utils";
import type { StudioTableRef } from "./supabase-tables-utils";
import { layoutTiles } from "./table-map-layout";

const MAP_LIMIT = 60;
const rowsFormat = new Intl.NumberFormat("de-DE");

export function SupabaseTablesMap({
  reference,
  onSelect,
}: {
  reference: string;
  onSelect: (table: StudioTableRef) => void;
}) {
  const tables = useQuery({
    queryKey: ["supabase", reference, "studio-tables", "list", "public", "", 0],
    queryFn: () => studioTablesList(reference, "public", "", 0),
    placeholderData: keepPreviousData,
  });
  const items = tables.data?.tables;
  const { tiles, largest, hidden } = useMemo(() => {
    const sorted = (items ?? [])
      .filter((table) => table.kind === "table" || table.kind === "partitioned_table")
      .sort((a, b) => (b.estimated_rows ?? 0) - (a.estimated_rows ?? 0));
    const shown = sorted.slice(0, MAP_LIMIT);
    return {
      tiles: layoutTiles(shown, (table: StudioTable) => Math.sqrt((table.estimated_rows ?? 0) + 1)),
      largest: Math.max(1, ...shown.map((table) => table.estimated_rows ?? 0)),
      hidden: sorted.length - shown.length,
    };
  }, [items]);

  if (tables.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(tables.error)}
      </p>
    );
  if (tables.isPending) return <p className="text-xs text-muted-foreground">Wird geladen…</p>;
  if (tiles.length === 0)
    return (
      <p className="text-xs text-muted-foreground">Das Schema public enthält keine Tabellen.</p>
    );

  return (
    <figure className="m-0 space-y-2">
      <ul
        aria-label="Tabellen in public nach Größe"
        className="relative h-[clamp(20rem,58vh,44rem)] overflow-hidden rounded-2xl border bg-muted/30"
      >
        {tiles.map(({ item, x, y, w, h }) => {
          const rows = item.estimated_rows ?? 0;
          const strength = 0.05 + 0.25 * Math.sqrt(rows / largest);
          const roomy = w * h > 0.02;
          return (
            <li
              key={`${item.schema}.${item.name}`}
              className="absolute p-0.5"
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
              }}
            >
              <button
                type="button"
                onClick={() => onSelect({ schema: item.schema, name: item.name })}
                title={`${item.name}: ~${rows.toLocaleString("de-DE")} Zeilen${item.rls_enabled ? "" : " · RLS aus"}`}
                className={cn(
                  "flex size-full min-w-0 flex-col items-start justify-between overflow-hidden rounded-xl border p-2.5 text-left transition-[border-color,filter] hover:border-primary/60 hover:brightness-[1.03] focus-visible:outline-2 focus-visible:outline-primary",
                  item.rls_enabled
                    ? "border-transparent"
                    : "border-dashed border-destructive/60 bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,color-mix(in_oklch,var(--destructive)_4%,transparent)_6px,color-mix(in_oklch,var(--destructive)_4%,transparent)_12px)]",
                )}
                style={{
                  backgroundColor: `color-mix(in oklch, var(--chart-1) ${Math.round(strength * 100)}%, var(--card))`,
                }}
              >
                <span className="w-full truncate text-xs font-semibold">{item.name}</span>
                {roomy && (
                  <span className="flex w-full items-end justify-between gap-2">
                    <span className="text-lg font-semibold tabular-nums tracking-tight">
                      {rowsFormat.format(rows)}
                    </span>
                    {!item.rls_enabled && (
                      <span className="text-[10px] font-medium text-destructive">RLS aus</span>
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <figcaption className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Fläche und Farbe zeigen die geschätzte Zeilenzahl. Gestrichelt: ohne RLS.</span>
        {(hidden > 0 || tables.data?.has_more) && (
          <span>
            {tables.data?.has_more
              ? "Gezeigt werden die ersten 100 Tabellen nach Name, weitere in der Liste links"
              : `${hidden} kleinere Tabellen nur in der Liste links`}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
