import type { FeatureEntry } from "@/lib/discovery/catalog";
import { startGuide } from "@/lib/discovery/guide";
import { highlightFeature } from "@/lib/discovery/highlight";
import { cn } from "@/lib/utils";

export function DiscoverFeatureCard({ feature, used }: { feature: FeatureEntry; used?: boolean }) {
  return (
    <div className="relative">
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
        {feature.steps?.length ? <span className="h-5" /> : null}
      </button>
      {feature.steps?.length ? (
        <button
          type="button"
          onClick={() => startGuide(feature.id)}
          className="absolute right-3 bottom-3 cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground active:scale-[0.97]"
        >
          Zeig's mir
        </button>
      ) : null}
    </div>
  );
}
