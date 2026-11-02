import { Star } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { atlasFacts, describeAtlasTable } from "./atlas-format";
import type { AtlasMetric, AtlasTile as Tile } from "./atlas-layout";

export type AtlasTone = "idle" | "active" | "neighbor" | "dim";
export type AtlasMark = "open" | "favorite" | null;

interface AtlasTileProps {
  tile: Tile;
  index: number;
  width: number;
  height: number;
  tone: AtlasTone;
  mark: AtlasMark;
  metric: AtlasMetric;
  focusable: boolean;
}

export const AtlasTile = memo(function AtlasTile({
  tile,
  index,
  width,
  height,
  tone,
  mark,
  metric,
  focusable,
}: AtlasTileProps) {
  const area = tile.w * tile.h;
  const showName = tile.w >= 44 && tile.h >= 20;
  const showMeta = tile.w >= 64 && tile.h >= 44;
  const facts = describeAtlasTable(tile);
  const [primary, secondary] = atlasFacts(tile, metric);
  const fill = 5 + tile.heat * 40;
  return (
    <button
      type="button"
      data-atlas-index={index}
      tabIndex={focusable ? 0 : -1}
      aria-label={[
        tile.name,
        facts,
        mark === "favorite" ? "Favorit" : mark === "open" ? "geöffnet" : "",
      ]
        .filter(Boolean)
        .join(", ")}
      title={facts ? `${tile.name} · ${facts}` : tile.name}
      className={cn(
        "group absolute flex flex-col items-start justify-between overflow-hidden rounded-[3px] border-[1.5px] border-[var(--atlas-ground)] px-2 py-1.5 text-left outline-none",
        "transition-[left,top,width,height,opacity,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        "focus-visible:z-10 focus-visible:shadow-[inset_0_0_0_2px_var(--primary)]",
        tone === "active" && "z-10 shadow-[inset_0_0_0_2px_var(--primary)]",
        tone === "neighbor" &&
          "shadow-[inset_0_0_0_1.5px_color-mix(in_oklch,var(--primary)_70%,transparent)]",
        tone === "dim" && "opacity-40",
      )}
      style={{
        left: `${(tile.x / width) * 100}%`,
        top: `${(tile.y / height) * 100}%`,
        width: `${(tile.w / width) * 100}%`,
        height: `${(tile.h / height) * 100}%`,
        background: `color-mix(in oklch, var(--chart-1) ${
          tone === "neighbor" || tone === "active" ? Math.max(fill, 30) : fill
        }%, var(--card))`,
      }}
    >
      {showName && (
        <span
          className={cn(
            "block max-w-full truncate font-mono font-medium leading-tight tracking-[-0.01em]",
            area > 42_000 ? "text-[15px]" : area > 12_000 ? "text-[12.5px]" : "text-[11px]",
          )}
        >
          {tile.name}
        </span>
      )}
      {showMeta && primary && (
        <span className="block max-w-full text-[10.5px] leading-tight tabular-nums text-muted-foreground">
          <span className="block truncate font-medium text-foreground/75">{primary}</span>
          {secondary && tile.h >= 72 && <span className="block truncate">{secondary}</span>}
        </span>
      )}
      {mark && (
        <span className="absolute right-1.5 top-1.5" aria-hidden="true">
          {mark === "favorite" ? (
            <Star className="size-2.5 fill-current text-primary" />
          ) : (
            <span className="block size-1.5 rounded-full bg-primary" />
          )}
        </span>
      )}
    </button>
  );
});
