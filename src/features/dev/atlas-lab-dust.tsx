import { useMemo, useState } from "react";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { cn } from "@/lib/utils";
import { auroraStyle, type LabTable, labFacts, labLayout, placeStyle } from "./atlas-lab-data";

const FEATURED = 14;

export function AtlasLabDust({ tables }: { tables: LabTable[] }) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<LabTable | null>(null);
  const featured = useMemo(() => tables.slice(0, FEATURED), [tables]);
  const dust = tables.slice(FEATURED);
  const tiles = useMemo(() => labLayout(featured, 0, 0, width, height), [featured, width, height]);

  return (
    <div className="flex h-full w-full gap-4" onPointerLeave={() => setHover(null)}>
      <div ref={ref} className="relative h-full min-w-0 flex-[1.6]">
        {width > 0 &&
          tiles.map((tile) => (
            <div
              key={tile.name}
              className="absolute p-1"
              style={placeStyle(tile, width, height)}
              onPointerEnter={() => setHover(tile)}
            >
              <div
                className={cn(
                  "flex h-full w-full flex-col justify-between overflow-hidden rounded-xl px-3 py-2.5 shadow-[inset_0_1px_0_color-mix(in_oklch,white_18%,transparent)] transition-[filter] duration-200",
                  hover?.name === tile.name && "brightness-125 saturate-150",
                )}
                style={auroraStyle(tile, width, height, 80 - tile.heat * 40)}
              >
                <span className="truncate font-mono text-[12.5px] font-medium">{tile.name}</span>
                {tile.h >= 56 && (
                  <span className="truncate text-[10.5px] tabular-nums text-muted-foreground">
                    {labFacts(tile)}
                  </span>
                )}
              </div>
            </div>
          ))}
      </div>
      {dust.length > 0 && (
        <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl bg-card/40 p-4 backdrop-blur-md">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium">{dust.length} weitere Tabellen</span>
            <span className="truncate text-muted-foreground">
              {hover && !featured.includes(hover) ? hover.name : "Größe = Punkt"}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-wrap content-start items-center gap-[5px] overflow-hidden">
            {dust.map((table) => {
              const size = 6 + table.heat * 22;
              return (
                <span
                  key={table.name}
                  title={`${table.name} · ${labFacts(table)}`}
                  onPointerEnter={() => setHover(table)}
                  className={cn(
                    "rounded-full bg-gradient-to-br from-[var(--chart-1)] to-[var(--chart-3)] transition-transform duration-150",
                    hover?.name === table.name && "scale-150",
                  )}
                  style={{ width: size, height: size, opacity: 0.35 + table.heat * 1.4 }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
