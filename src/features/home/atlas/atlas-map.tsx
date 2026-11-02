import { useEffect, useMemo, useRef, useState } from "react";
import { useElementSize } from "@/lib/hooks/use-element-size";
import {
  type AtlasDirection,
  type AtlasNeighbors,
  type AtlasTable,
  layoutAtlas,
  nextAtlasTile,
  type AtlasTile as Tile,
} from "./atlas-layout";
import { type AtlasMark, AtlasTile, type AtlasTone } from "./atlas-tile";

export interface AtlasFocus {
  key: string | null;
  live: boolean;
}

interface AtlasMapProps {
  tables: AtlasTable[];
  neighbors: AtlasNeighbors;
  query: string;
  focus: AtlasFocus;
  marks: Map<string, AtlasMark>;
  onFocus: (focus: AtlasFocus) => void;
  onOpen: (tile: Tile) => void;
}

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const RETARGET_MS = 110;

export function AtlasMap({
  tables,
  neighbors,
  query,
  focus,
  marks,
  onFocus,
  onOpen,
}: AtlasMapProps) {
  const { ref, width, height } = useElementSize<HTMLFieldSetElement>();
  const [cursor, setCursor] = useState(0);
  const intent = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(intent.current), []);
  const { tiles, metric } = useMemo(
    () => layoutAtlas(tables, width, height, query),
    [tables, width, height, query],
  );
  const related = useMemo(
    () => new Set([...neighbors.outgoing, ...neighbors.incoming]),
    [neighbors],
  );
  const focusable = Math.min(cursor, tiles.length - 1);

  const tileAt = (target: EventTarget | null) => {
    const element = (target as HTMLElement | null)?.closest<HTMLElement>("[data-atlas-index]");
    const index = element ? Number(element.dataset.atlasIndex) : -1;
    return index >= 0 ? { index, tile: tiles[index] } : null;
  };

  const move = (index: number) => {
    setCursor(index);
    ref.current?.querySelector<HTMLButtonElement>(`[data-atlas-index="${index}"]`)?.focus();
  };

  const tone = (tile: Tile): AtlasTone => {
    if (!focus.key) return "idle";
    if (tile.key === focus.key) return "active";
    if (related.has(tile.key)) return "neighbor";
    return focus.live ? "dim" : "idle";
  };

  return (
    <fieldset
      ref={ref}
      aria-label={`Tabellenkarte, ${tiles.length} Tabellen. Pfeiltasten wechseln die Tabelle, Enter öffnet sie.`}
      className="relative m-0 h-full w-full min-w-0 border-0 p-0"
      onPointerOver={(event) => {
        const hit = tileAt(event.target);
        if (!hit) return;
        window.clearTimeout(intent.current);
        const next = { key: hit.tile.key, live: true };
        if (!focus.live) onFocus(next);
        else if (hit.tile.key !== focus.key)
          intent.current = window.setTimeout(() => onFocus(next), RETARGET_MS);
      }}
      onPointerLeave={() => {
        window.clearTimeout(intent.current);
        if (focus.live) onFocus({ key: focus.key, live: false });
      }}
      onFocus={(event) => {
        const hit = tileAt(event.target);
        if (!hit) return;
        setCursor(hit.index);
        onFocus({ key: hit.tile.key, live: true });
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onFocus({ key: focus.key, live: false });
      }}
      onClick={(event) => {
        const hit = tileAt(event.target);
        if (hit) onOpen(hit.tile);
      }}
      onKeyDown={(event) => {
        const hit = tileAt(event.target);
        if (!hit) return;
        if (ARROWS.has(event.key)) {
          event.preventDefault();
          move(nextAtlasTile(tiles, hit.index, event.key as AtlasDirection));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          move(event.key === "Home" ? 0 : tiles.length - 1);
        } else if (event.key === "Escape" && focus.key) {
          event.stopPropagation();
          onFocus({ key: null, live: false });
        }
      }}
    >
      {width > 0 &&
        height > 0 &&
        tiles.map((tile, index) => (
          <AtlasTile
            key={tile.key}
            tile={tile}
            index={index}
            width={width}
            height={height}
            tone={tone(tile)}
            mark={marks.get(tile.key) ?? null}
            metric={metric}
            focusable={index === focusable}
          />
        ))}
    </fieldset>
  );
}
