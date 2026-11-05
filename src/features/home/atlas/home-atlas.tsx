import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Search, Table2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useSchemaMapQuery, useTablesQuery } from "@/lib/queries";
import { useSettingsStore } from "@/lib/settings";
import { previewQuery } from "@/lib/sql-filter/quote";
import { useTableTabs } from "@/lib/table-tabs";
import {
  ATLAS_GRID_ROW,
  ATLAS_TILE_LIMIT,
  type AtlasMetric,
  type AtlasNeighbors,
  atlasGrid,
  atlasKey,
  atlasMetric,
  atlasNeighbors,
  joinAtlas,
} from "./atlas-layout";
import { AtlasLens } from "./atlas-lens";
import { type AtlasFocus, AtlasMap } from "./atlas-map";
import { ContinueRail } from "./continue-rail";
import { SchemaStrip } from "./schema-strip";
import { useAtlasTrail } from "./use-atlas-trail";

const NO_NEIGHBORS: AtlasNeighbors = { outgoing: [], incoming: [] };

function atlasHeight(count: number, metric: AtlasMetric): string {
  const grid = atlasGrid(count, metric);
  if (grid) return `${grid.rows * ATLAS_GRID_ROW}px`;
  if (count <= 4) return "13rem";
  if (count <= 12) return "21rem";
  return "clamp(320px,calc(100vh - 430px),640px)";
}

export function HomeAtlas({ connection }: { connection: SavedConnection }) {
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const tables = useTablesQuery();
  const map = useSchemaMapQuery();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLElement>("home.atlas");
  const searchRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<AtlasFocus>({ key: null, live: false });
  const { entries, marks } = useAtlasTrail(connection.id, database);

  const atlasTables = useMemo(
    () => joinAtlas(tables.data ?? [], map.data),
    [tables.data, map.data],
  );
  const links = map.data?.links;
  const neighbors = useMemo(
    () => (focus.key && links?.length ? atlasNeighbors(links, focus.key) : NO_NEIGHBORS),
    [links, focus.key],
  );
  const summary = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? atlasTables.filter((table) => table.name.toLowerCase().includes(needle)).length
      : atlasTables.length;
    return {
      matching,
      hidden: Math.max(0, matching - ATLAS_TILE_LIMIT),
      metric: atlasMetric(atlasTables),
    };
  }, [atlasTables, query]);
  const focused = useMemo(
    () =>
      focus.key
        ? (atlasTables.find((table) => atlasKey(table.schema, table.name) === focus.key) ?? null)
        : null,
    [atlasTables, focus.key],
  );
  const showRelations = Boolean(links?.length);

  const open = (tableSchema: string, name: string, view = false) => {
    useTableTabs
      .getState()
      .openTab({ schema: tableSchema, table: name, entityType: view ? "view" : "table" });
    void navigate({ to: "/tables/$schema/$table", params: { schema: tableSchema, table: name } });
  };
  const openQuery = (tableSchema: string, name: string) => {
    const id = useTableTabs
      .getState()
      .openQueryTabWithSql(previewQuery(tableSchema, name, connection.kind, caps.query_language));
    void navigate({ to: "/query/$id", params: { id } });
  };

  const body =
    tables.isPending || (tables.isError && !queryErrorMessage(tables.error)) ? (
      <div aria-busy="true" className="grid h-full grid-cols-6 grid-rows-4 gap-[3px]">
        {[
          "col-span-3 row-span-3",
          "col-span-2 row-span-2",
          "row-span-2",
          "row-span-2 col-span-2",
          "row-span-1",
          "col-span-2",
          "col-span-1",
        ].map((span) => (
          <Skeleton key={span} className={`rounded-[3px] ${span}`} />
        ))}
      </div>
    ) : tables.isError ? (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p role="alert" className="max-w-md text-xs leading-relaxed text-destructive">
          {queryErrorMessage(tables.error)}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mx-auto"
          onClick={() => void tables.refetch()}
        >
          Erneut versuchen
        </Button>
      </div>
    ) : !atlasTables.length ? (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <Table2 className="mx-auto size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Dieses Schema enthält noch keine Tabellen.</p>
        <Button variant="outline" size="sm" className="mx-auto" asChild>
          <Link to="/create-table">
            <Plus className="size-3" />
            Tabelle erstellen
          </Link>
        </Button>
      </div>
    ) : summary.matching === 0 ? (
      <div className="grid h-full place-content-center p-6 text-center text-sm text-muted-foreground">
        Keine Tabelle passt zu „{query.trim()}“.
      </div>
    ) : (
      <AtlasMap
        tables={atlasTables}
        neighbors={neighbors}
        query={query}
        focus={focus}
        marks={marks}
        onFocus={setFocus}
        onOpen={(tile) => open(tile.schema, tile.name)}
      />
    );

  return (
    <section
      ref={feature.ref}
      aria-label="Datenbank-Atlas"
      className="grid gap-x-10 gap-y-8 @4xl/home:grid-cols-[minmax(0,1fr)_17.5rem]"
    >
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <SchemaStrip connectionId={connection.id} schema={schema} />
            {!map.isPending &&
              atlasTables.length > 0 &&
              (summary.metric === null || summary.metric === "links") && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {summary.metric === null
                    ? "Tabellengrößen unbekannt – Kacheln gleich groß dargestellt"
                    : "Tabellengrößen unbekannt – Fläche zeigt die Fremdschlüssel"}
                </p>
              )}
          </div>
          <div className="relative flex items-center gap-2">
            {feature.isNew && <NewBadge />}
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              className="h-8 w-56 pl-8 text-xs"
              aria-label={`Tabellen in ${schema} finden`}
              placeholder={`Tabelle in ${schema} finden…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  mapRef.current
                    ?.querySelector<HTMLButtonElement>('[data-atlas-index="0"]')
                    ?.focus();
                } else if (event.key === "Enter") {
                  const exact = atlasTables.find(
                    (table) => table.name.toLowerCase() === query.trim().toLowerCase(),
                  );
                  if (exact) open(exact.schema, exact.name);
                  else
                    mapRef.current
                      ?.querySelector<HTMLButtonElement>('[data-atlas-index="0"]')
                      ?.click();
                }
              }}
            />
          </div>
        </div>
        <div
          ref={mapRef}
          className="-m-0.5 overflow-hidden"
          style={{ height: atlasHeight(summary.matching, summary.metric) }}
        >
          {body}
        </div>
        <div className="mt-3">
          <AtlasLens
            table={focused}
            neighbors={neighbors}
            metric={summary.metric}
            sizesPending={map.isPending}
            notice={map.isError ? String(map.error) : (map.data?.warning ?? null)}
            hidden={summary.hidden}
            matching={summary.matching}
            showRelations={showRelations && caps.foreign_keys}
            showEr={caps.foreign_keys && !easyMode}
            onWalk={(key) => setFocus({ key, live: false })}
            onOpen={open}
            onQuery={openQuery}
            onClear={() => setFocus({ key: null, live: false })}
          />
        </div>
      </div>
      <div>
        <ContinueRail
          connectionId={connection.id}
          database={database}
          schema={schema}
          entries={entries}
          onSpotlight={(key) =>
            setFocus((current) => (key ? { key, live: true } : { ...current, live: false }))
          }
          onOpen={open}
        />
      </div>
    </section>
  );
}
