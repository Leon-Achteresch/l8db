import { useState } from "react";
import {
  buildContextMap,
  type ContextLayout,
  type ContextTileKind,
  placeContextMap,
} from "@/lib/ai/context-map";
import type { AiSession } from "@/lib/ai/store";
import type { AiMessage } from "@/lib/db/ai";
import { cn } from "@/lib/utils";

const WIDTH = 400;
const HEIGHT = 200;

const TONES: Record<ContextTileKind, string> = {
  system: "bg-muted text-foreground/75",
  project: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  tools: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  context: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
  chat: "bg-purple-500/12 text-purple-700 dark:text-purple-300",
  results: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  summary: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  draft: "bg-foreground/[0.06] text-foreground/70",
  other: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

const KINDS: Record<ContextTileKind, string> = {
  system: "System",
  project: "Projekt",
  tools: "Tools",
  context: "Kontext",
  chat: "Chat",
  results: "Tool-Ergebnis",
  summary: "Komprimiert",
  draft: "Eingabe",
  other: "Agent",
};

function formatTokens(value: number) {
  return value >= 1000
    ? `${(value / 1000).toLocaleString("de-DE", { maximumFractionDigits: value >= 100_000 ? 0 : 1 })}k`
    : value.toLocaleString("de-DE");
}

interface Props {
  layout: ContextLayout;
  messages: AiMessage[];
  summary?: AiSession["summary"];
  prompt: string;
  measured: number | null;
  limit: number;
}

export function AiContextMap({ layout, messages, summary, prompt, measured, limit }: Props) {
  const [before, setBefore] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const after = buildContextMap({ layout, messages, summary, prompt, measured, limit });
  const map =
    before && after.compacted
      ? buildContextMap({
          layout,
          messages,
          summary,
          prompt,
          measured: measured === null ? null : measured + after.saved,
          limit,
          compact: false,
        })
      : after;
  const placed = placeContextMap(map, WIDTH, HEIGHT);
  const free = Math.max(0, map.limit - map.used);
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  const active = placed.tiles.find((tile) => tile.id === focused);
  return (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label={`Kontext: ${formatTokens(map.used)} von ${formatTokens(map.limit)} belegt`}
        className="relative aspect-[2/1] w-full overflow-hidden rounded-lg"
        data-testid="ai-context-map"
      >
        {placed.tiles.map((tile) => {
          const labelled = tile.w >= 30 && tile.h >= 16;
          const detailed = tile.w >= 40 && tile.h >= 30;
          return (
            <button
              type="button"
              key={tile.id}
              data-tile={tile.id}
              aria-label={`${tile.label} · ${formatTokens(tile.tokens)} · ${KINDS[tile.kind]}`}
              onPointerEnter={() => setFocused(tile.id)}
              onPointerLeave={() => setFocused(null)}
              onFocus={() => setFocused(tile.id)}
              onBlur={() => setFocused(null)}
              className={cn(
                "absolute cursor-default p-px text-left outline-none transition-[left,top,width,height,opacity] duration-500 ease-out motion-reduce:transition-none",
                active && active.id !== tile.id && "opacity-40",
              )}
              style={{
                left: percent(tile.x, WIDTH),
                top: percent(tile.y, HEIGHT),
                width: percent(tile.w, WIDTH),
                height: percent(tile.h, HEIGHT),
              }}
            >
              <div
                className={cn(
                  "size-full overflow-hidden rounded-md px-1 py-0.5 leading-tight",
                  TONES[tile.kind],
                  active?.id === tile.id && "ring-2 ring-foreground/30",
                )}
              >
                {labelled && <div className="truncate font-medium">{tile.label}</div>}
                {detailed && (
                  <div className="truncate text-[10px] opacity-70 tabular-nums">
                    {formatTokens(tile.tokens)}
                    {KINDS[tile.kind] === tile.label ? "" : ` · ${KINDS[tile.kind]}`}
                  </div>
                )}
              </div>
            </button>
          );
        })}
        {placed.free && (
          <div
            data-tile="free"
            className="absolute p-px transition-[left,top,width,height] duration-500 ease-out motion-reduce:transition-none"
            style={{
              left: percent(placed.free.x, WIDTH),
              top: 0,
              width: percent(placed.free.w, WIDTH),
              height: "100%",
            }}
          >
            <div className="size-full overflow-hidden rounded-md border border-dashed border-foreground/15 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--foreground)_5%,transparent)_6px_7px)] px-1.5 py-1 leading-tight text-muted-foreground">
              {placed.free.w >= 40 && (
                <>
                  <div className="truncate">Frei</div>
                  <div className="truncate text-[10px] opacity-70 tabular-nums">
                    {formatTokens(free)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {active ? (
        <div
          className="flex items-center gap-2 text-[11px] tabular-nums"
          data-testid="ai-context-focus"
        >
          <span className="min-w-0 flex-1 break-all font-medium">{active.label}</span>
          <span className="shrink-0 text-muted-foreground">
            {formatTokens(active.tokens)} ·{" "}
            {(active.tokens / map.limit).toLocaleString("de-DE", {
              style: "percent",
              maximumFractionDigits: 1,
            })}
            {KINDS[active.kind] === active.label ? "" : ` · ${KINDS[active.kind]}`}
          </span>
        </div>
      ) : after.compacted > 0 ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {after.compacted} Nachrichten komprimiert · −{formatTokens(after.saved)}
          </span>
          <div className="flex rounded-md bg-muted/40 p-0.5">
            {[
              [true, "Vorher"],
              [false, "Nachher"],
            ].map(([value, label]) => (
              <button
                key={String(label)}
                type="button"
                aria-pressed={before === value}
                onClick={() => setBefore(Boolean(value))}
                className={cn(
                  "rounded px-1.5 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  before === value && "bg-background text-foreground shadow-sm",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/70">Noch nicht komprimiert</div>
      )}
    </div>
  );
}
