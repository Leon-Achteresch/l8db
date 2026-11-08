import { Search } from "lucide-react";
import { type KeyboardEvent, useDeferredValue, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { AtlasTile } from "@/features/discovery/atlas/atlas-tile";
import {
  ATLAS_FILTERS,
  type AtlasFilter,
  atlasNewIds,
  atlasProgress,
  filterAtlas,
  groupAtlas,
} from "@/lib/discovery/atlas/atlas";
import type { FeatureEntry } from "@/lib/discovery/catalog";
import type { FeatureUsage } from "@/lib/discovery/usage";
import { cn } from "@/lib/utils";

const NAV_KEYS = new Set(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]);

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!NAV_KEYS.has(event.key)) return;
  const tiles = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-atlas-tile]")];
  const index = tiles.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tiles.length - 1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? Math.min(tiles.length - 1, index + 1)
          : Math.max(0, index - 1);
  tiles[next]?.focus();
}

export function AtlasView({
  available,
  usage,
  initialFilter = "all",
}: {
  available: readonly FeatureEntry[];
  usage: FeatureUsage;
  initialFilter?: AtlasFilter;
}) {
  const [filter, setFilter] = useState<AtlasFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const progress = useMemo(() => atlasProgress(available, usage), [available, usage]);
  const newIds = useMemo(() => atlasNewIds(available), [available]);
  const groups = useMemo(
    () => groupAtlas(filterAtlas(available, { filter, query: deferredQuery, usage, newIds })),
    [available, filter, deferredQuery, usage, newIds],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-lg font-semibold">Du nutzt {progress.percent} % von l8db</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-label={`${progress.used} von ${progress.total}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Suchen"
            aria-label="Funktionen suchen"
            className="pl-8"
          />
        </div>
        <div role="radiogroup" aria-label="Filter" className="flex flex-wrap gap-1">
          {ATLAS_FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={filter === entry.id}
              onClick={() => setFilter(entry.id)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:scale-[0.97]",
                filter === entry.id && "bg-primary/15 font-medium text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Funktionen" className="space-y-6" onKeyDown={moveFocus}>
        {groups.length === 0 && <p className="text-sm text-muted-foreground">Nichts gefunden</p>}
        {groups.map(([area, entries]) => (
          <section key={area} className="space-y-2" aria-label={area}>
            <h2 className="text-sm font-semibold text-muted-foreground">{area}</h2>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map((entry) => (
                <AtlasTile
                  key={entry.id}
                  feature={entry}
                  used={usage[entry.id] !== undefined}
                  isNew={newIds.has(entry.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
