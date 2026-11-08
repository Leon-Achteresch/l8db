import { Film, MousePointer2 } from "lucide-react";
import { memo } from "react";
import type { FeatureEntry } from "@/lib/discovery/catalog";
import { startGuide } from "@/lib/discovery/guide";
import { highlightFeature } from "@/lib/discovery/highlight";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { cn } from "@/lib/utils";

const SECONDARY =
  "inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground active:scale-[0.97]";

export const AtlasTile = memo(function AtlasTile({
  feature,
  used,
  isNew,
}: {
  feature: FeatureEntry;
  used: boolean;
  isNew: boolean;
}) {
  return (
    <div
      className={cn(
        "group flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2 transition-colors",
        used ? "bg-primary/10 hover:bg-primary/15" : "bg-muted/40 hover:bg-muted/70",
      )}
    >
      <button
        type="button"
        data-atlas-tile=""
        title={feature.summary}
        onClick={() => void highlightFeature(feature.id)}
        className="flex min-w-0 cursor-pointer items-center gap-2 text-left outline-none focus-visible:underline active:opacity-80"
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            used ? "bg-primary" : "bg-muted-foreground/30",
          )}
        />
        <span className="sr-only">{used ? "Genutzt" : "Noch nie genutzt"}</span>
        <span className="truncate text-sm font-medium text-foreground">{feature.title}</span>
        {isNew && (
          <span className="shrink-0 rounded bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            NEU
          </span>
        )}
      </button>
      {(feature.steps?.length || feature.videoId) && (
        <span className="flex gap-1">
          {feature.steps?.length ? (
            <button type="button" className={SECONDARY} onClick={() => startGuide(feature.id)}>
              <MousePointer2 className="size-3" />
              Zeig's mir
            </button>
          ) : null}
          {feature.videoId && (
            <button
              type="button"
              className={SECONDARY}
              onClick={() => useFeatureVideoStore.getState().open(feature.videoId as string, true)}
            >
              <Film className="size-3" />
              Video
            </button>
          )}
        </span>
      )}
    </div>
  );
});
