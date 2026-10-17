import { ChevronDownIcon, FilterIcon, PaletteIcon, PlusIcon, SparklesIcon } from "lucide-react";
import type { CSSProperties } from "react";
import type { FilterBarStyle } from "@/lib/filter-bar-style";
import { cn } from "@/lib/utils";

const ROWS = [
  ["1041", "paid", "248,90", ""],
  ["1042", "failed", "89,10", "#ef4444"],
  ["1043", "paid", "1.204,00", "#eab308"],
] as const;

const toggle = (
  <span className="flex shrink-0 overflow-hidden rounded border border-border/80 text-[8px]">
    <span className="bg-muted px-1 text-foreground">Einfach</span>
    <span className="border-l border-border/80 px-1 text-muted-foreground">SQL</span>
  </span>
);

export function FilterBarStylePreview({ style }: { style: FilterBarStyle }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none flex h-32 flex-col gap-1.5 bg-background p-2 text-[9px] select-none"
    >
      {style === "classic" ? (
        <div className="rounded border border-border/70 bg-muted/40 p-1.5">
          <div className="flex items-center gap-1 font-medium">
            <FilterIcon className="size-2.5 text-muted-foreground" />
            Filter
            <ChevronDownIcon className="size-2.5 rotate-180 text-muted-foreground" />
            <span className="ml-auto">
              <PaletteIcon className="size-2.5 text-muted-foreground" />
            </span>
          </div>
          <div className="mt-1 grid grid-cols-[1.5rem_1fr_1fr_1fr] gap-1">
            <span className="text-right text-muted-foreground">Wo</span>
            <span className="rounded border border-border/70 px-1">status</span>
            <span className="rounded border border-border/70 px-1">ist gleich</span>
            <span className="rounded border border-border/70 px-1">failed</span>
          </div>
        </div>
      ) : style === "omnibar" ? (
        <div className="flex items-center gap-1 rounded-md border border-ring/60 bg-background px-1 py-1">
          {toggle}
          <span className="rounded bg-muted px-1 font-mono">status = failed</span>
          <span className="truncate text-muted-foreground">nur letzte Woche|</span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 text-violet-500">
            <SparklesIcon className="size-2.5" />
            KI
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {toggle}
          <span className="flex overflow-hidden rounded border border-border">
            <span className="px-1">status</span>
            <span className="border-l border-border/70 px-1 text-muted-foreground">=</span>
            <span className="border-l border-border/70 px-1 font-mono">failed</span>
          </span>
          <span className="grid size-3.5 place-items-center rounded border border-dashed border-border text-muted-foreground">
            <PlusIcon className="size-2.5" />
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-violet-500">
            <SparklesIcon className="size-2.5" />
            KI
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded border border-border/70">
        {ROWS.map(([id, status, total, color]) => (
          <div
            key={id}
            className={cn(
              "grid grid-cols-[2rem_1fr_3rem] border-t border-border/60 px-1.5 py-0.5 first:border-t-0",
              color && "shadow-[inset_2px_0_0_var(--rule)]",
            )}
            style={
              color
                ? ({
                    "--rule": color,
                    backgroundColor: `color-mix(in oklab, ${color} 18%, var(--background))`,
                  } as CSSProperties)
                : undefined
            }
          >
            <span className="font-mono text-muted-foreground">{id}</span>
            <span>{status}</span>
            <span className="text-right font-mono">{total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
