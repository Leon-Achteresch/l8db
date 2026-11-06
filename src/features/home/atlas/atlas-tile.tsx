import { Star } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { atlasFacts, describeAtlasTable } from "./atlas-format";
import type { AtlasMetric, AtlasTile as Tile } from "./atlas-layout";

const AURORA = [
  "radial-gradient(60% 75% at 0% 0%, var(--chart-1), transparent)",
  "linear-gradient(135deg, var(--chart-1), var(--chart-2) 55%, var(--chart-3))",
];

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
  const showName = tile.w >= 52 && tile.h >= 28;
  const showMeta = tile.w >= 72 && tile.h >= 52;
  const facts = describeAtlasTable(tile);
  const [primary, secondary] = atlasFacts(tile, metric);
  const lift =
    tone === "active"
      ? Math.max(tile.heat, 0.8)
      : tone === "neighbor"
        ? Math.max(tile.heat, 0.55)
        : tile.heat;
  const veil = 82 - lift * 36;
  const span = `${(width / tile.w) * 100}% ${(height / tile.h) * 100}%`;
  const at = `${tile.w < width ? (tile.x / (width - tile.w)) * 100 : 0}% ${
    tile.h < height ? (tile.y / (height - tile.h)) * 100 : 0
  }%`;
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
        "group absolute flex flex-col items-start justify-between overflow-hidden rounded-[14px] border-4 border-transparent bg-clip-padding px-3 py-2.5 text-left outline-none",
        "shadow-[inset_0_1px_0_color-mix(in_oklch,white_18%,transparent)]",
        "transition-[left,top,width,height,opacity,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        "focus-visible:z-10 focus-visible:shadow-[inset_0_0_0_2px_var(--primary)]",
        tone === "active" &&
          "z-10 shadow-[inset_0_0_0_1.5px_var(--primary),0_12px_32px_-12px_color-mix(in_oklch,var(--primary)_80%,transparent)]",
        tone === "neighbor" &&
          "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_65%,transparent)]",
        tone === "dim" && "opacity-40",
      )}
      style={{
        left: `${(tile.x / width) * 100}%`,
        top: `${(tile.y / height) * 100}%`,
        width: `${(tile.w / width) * 100}%`,
        height: `${(tile.h / height) * 100}%`,
        backgroundImage: [
          `linear-gradient(color-mix(in oklch, var(--card) ${Math.min(94, veil + 8)}%, transparent), color-mix(in oklch, var(--card) ${veil - 6}%, transparent))`,
          ...AURORA,
        ].join(", "),
        backgroundSize: ["100% 100%", ...AURORA.map(() => span)].join(", "),
        backgroundPosition: ["0 0", ...AURORA.map(() => at)].join(", "),
      }}
    >
      {showName && (
        <span
          className={cn(
            "block max-w-full truncate font-mono font-medium leading-tight tracking-[-0.01em]",
            area > 60_000 ? "text-[15px]" : area > 18_000 ? "text-[13px]" : "text-[11.5px]",
          )}
        >
          {tile.name}
        </span>
      )}
      {showMeta && primary && (
        <span className="block max-w-full text-[10.5px] leading-tight tabular-nums text-muted-foreground">
          <span className="block truncate font-medium text-foreground/75">{primary}</span>
          {secondary && tile.h >= 80 && <span className="block truncate">{secondary}</span>}
        </span>
      )}
      {mark && (
        <span className="absolute right-2.5 top-2.5" aria-hidden="true">
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
