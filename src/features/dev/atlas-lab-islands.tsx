import { useMemo, useState } from "react";
import { squarify } from "@/features/dashboard/charts/svg-geometry";
import { formatBytes } from "@/features/monitor/monitor-view/format";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { cn } from "@/lib/utils";
import {
  auroraStyle,
  type LabTable,
  labFacts,
  labGroups,
  labLayout,
  placeStyle,
} from "./atlas-lab-data";

const GAP = 5;
const HEADER = 22;

export function AtlasLabIslands({ tables }: { tables: LabTable[] }) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const islands = useMemo(() => {
    const groups = labGroups(tables).map((group) => ({
      ...group,
      value: group.tables.reduce((total, table) => total + table.weight, 0),
    }));
    return squarify(groups, 0, 0, width, height).map(({ item, x, y, width: w, height: h }) => {
      const box = { x: x + GAP / 2, y: y + GAP / 2, w: w - GAP, h: h - GAP };
      const header = box.h > 60 && box.w > 70 ? HEADER : 0;
      return {
        ...item,
        box,
        header,
        tiles: labLayout(item.tables, box.x + 3, box.y + header + 3, box.w - 6, box.h - header - 6),
      };
    });
  }, [tables, width, height]);
  const active = islands.find((island) => island.tables.some((table) => table.name === hover));
  const hovered = active?.tables.find((table) => table.name === hover);

  return (
    <div ref={ref} className="relative h-full w-full" onPointerLeave={() => setHover(null)}>
      {width > 0 &&
        islands.map((island) => (
          <div key={island.name}>
            <div
              className={cn(
                "absolute rounded-xl bg-card/35 shadow-[0_8px_24px_-16px_color-mix(in_oklch,var(--chart-1)_60%,transparent)] backdrop-blur-md transition-opacity duration-200",
                active && active !== island && "opacity-50",
              )}
              style={placeStyle(island.box, width, height)}
            >
              {island.header > 0 && (
                <div className="flex items-baseline gap-1.5 px-2.5 pt-1 text-[11px]">
                  <span className="truncate font-semibold tracking-wide">{island.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {island.tables.length} · {formatBytes(island.bytes)}
                  </span>
                </div>
              )}
            </div>
            {island.tiles.map((tile) => (
              <div
                key={tile.name}
                className="absolute p-px"
                style={placeStyle(tile, width, height)}
                onPointerEnter={() => setHover(tile.name)}
              >
                <div
                  className={cn(
                    "flex h-full w-full items-end overflow-hidden rounded-[4px] px-1.5 py-1 transition-[filter,opacity] duration-200",
                    hover === tile.name && "brightness-125 saturate-150",
                    active && active !== island && "opacity-40",
                  )}
                  style={auroraStyle(tile, width, height, 84 - tile.heat * 44)}
                >
                  {tile.w >= 76 && tile.h >= 22 && (
                    <span className="truncate font-mono text-[10.5px] text-foreground/80">
                      {tile.name.slice(tile.group.length + 1) || tile.name}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      <div
        className={cn(
          "pointer-events-none absolute bottom-3 left-3 rounded-full bg-background/60 px-3 py-1.5 text-xs shadow-lg backdrop-blur-xl transition-opacity duration-200",
          hovered ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="font-mono font-medium">{hovered?.name}</span>
        <span className="ml-2 text-muted-foreground tabular-nums">
          {hovered && labFacts(hovered)}
        </span>
      </div>
    </div>
  );
}
