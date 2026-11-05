import { Star } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { atlasFacts, describeAtlasTable, formatLinks } from "./atlas-format";
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
  const [facts1, facts2] = atlasFacts(tile, metric);
  const links = tile.links ? formatLinks(tile.links) : null;
  const unknown =
    metric !== "bytes" && metric !== "rows" && tile.rows == null && tile.bytes == null;
  const primary = facts1 ?? links ?? tile.comment ?? (unknown ? "Größe unbekannt" : null);
  const secondary = facts1 ? facts2 : links ? tile.comment : null;
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
        "group absolute flex flex-col items-start justify-between overflow-hidden rounded-[10px] border-2 border-transparent bg-card bg-clip-padding px-2.5 py-2 text-left outline-none",
        "shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted/60",
        "transition-[left,top,width,height,opacity,box-shadow,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        "focus-visible:z-10 focus-visible:shadow-[inset_0_0_0_2px_var(--primary)]",
        tone === "active" && "z-10 bg-muted/60 shadow-[inset_0_0_0_1.5px_var(--primary)]",
        tone === "neighbor" &&
          "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_55%,var(--border))]",
        tone === "dim" && "opacity-40",
      )}
      style={{
        left: `${(tile.x / width) * 100}%`,
        top: `${(tile.y / height) * 100}%`,
        width: `${(tile.w / width) * 100}%`,
        height: `${(tile.h / height) * 100}%`,
      }}
    >
      {showName && (
        <span
          className={cn(
            "block max-w-full truncate font-mono font-medium leading-tight",
            area > 42_000 ? "text-[15px]" : area > 12_000 ? "text-[13px]" : "text-[11px]",
          )}
        >
          {tile.name}
        </span>
      )}
      {showMeta && primary && (
        <span className="block max-w-full text-xs leading-snug tabular-nums text-muted-foreground">
          <span className={cn("block truncate", !unknown && "font-medium text-foreground")}>
            {primary}
          </span>
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
