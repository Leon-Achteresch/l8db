import type { FeatureEntry } from "@/lib/discovery/catalog";
import { highlightFeature } from "@/lib/discovery/highlight";
import { cn } from "@/lib/utils";

export function DiscoverFeatureCard({ feature, used }: { feature: FeatureEntry; used?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => void highlightFeature(feature.id)}
      className={cn(
        "group flex w-full cursor-pointer flex-col items-start gap-1 rounded-xl bg-muted/40 p-4 text-left transition-colors hover:bg-muted/70 active:scale-[0.99]",
        used && "opacity-70",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{feature.title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{feature.area}</span>
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">{feature.summary}</span>
    </button>
  );
}
