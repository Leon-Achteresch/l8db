import { useMemo, useState } from "react";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { cn } from "@/lib/utils";
import {
  auroraStyle,
  type LabTable,
  type LabTile,
  labFacts,
  labLayout,
  placeStyle,
} from "./atlas-lab-data";

export function AtlasLabPane({ tables }: { tables: LabTable[] }) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<LabTile | null>(null);
  const tiles = useMemo(() => labLayout(tables, 0, 0, width, height), [tables, width, height]);

  return (
    <div
      ref={ref}
      className="relative h-full w-full overflow-hidden rounded-2xl"
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 &&
        tiles.map((tile) => {
          const showName = tile.w >= 70 && tile.h >= 26;
          const showMeta = tile.w >= 90 && tile.h >= 52;
          const active = hover?.name === tile.name;
          return (
            <div
              key={tile.name}
              className="absolute p-px"
              style={placeStyle(tile, width, height)}
              onPointerEnter={() => setHover(tile)}
            >
              <div
                className={cn(
                  "flex h-full w-full flex-col justify-between overflow-hidden rounded-[3px] px-2 py-1.5 transition-[filter] duration-200",
                  active && "brightness-125 saturate-150",
                )}
                style={auroraStyle(tile, width, height, active ? 30 : 86 - tile.heat * 46)}
              >
                {showName && (
                  <span className="truncate font-mono text-[11.5px] font-medium leading-tight">
                    {tile.name}
                  </span>
                )}
                {showMeta && (
                  <span className="truncate text-[10.5px] tabular-nums text-muted-foreground">
                    {labFacts(tile)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      <div
        className={cn(
          "pointer-events-none absolute bottom-3 left-3 rounded-full bg-background/60 px-3 py-1.5 text-xs shadow-lg backdrop-blur-xl transition-opacity duration-200",
          hover ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="font-mono font-medium">{hover?.name}</span>
        <span className="ml-2 text-muted-foreground tabular-nums">{hover && labFacts(hover)}</span>
      </div>
    </div>
  );
}
