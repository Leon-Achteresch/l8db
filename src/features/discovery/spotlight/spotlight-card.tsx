import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpotlightArt } from "@/features/discovery/spotlight/spotlight-art";
import { FeatureClip } from "@/features/discovery/video-tooltips/feature-clip";
import type { FeatureEntry } from "@/lib/discovery/types";
import { resolveClip } from "@/lib/discovery/video-tooltips/media";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";

export function SpotlightCard({
  entry,
  index,
  onTry,
}: {
  entry: FeatureEntry;
  index: number;
  onTry: (id: string) => void;
}) {
  const hasClip = useFeatureVideoStore(
    (state) => resolveClip(entry.videoId, state.feed, true) !== null,
  );
  return (
    <article className="group/card flex flex-col gap-4 rounded-2xl bg-muted/40 p-2 pb-4 transition-colors hover:bg-muted/60">
      {hasClip ? (
        <FeatureClip videoId={entry.videoId} title={entry.title} />
      ) : (
        <SpotlightArt id={entry.id} index={index} />
      )}
      <div className="flex flex-1 flex-col gap-1 px-2">
        <h3 className="text-[15px] font-semibold tracking-tight">{entry.title}</h3>
        <p className="text-[13px] leading-5 text-muted-foreground">{entry.summary}</p>
      </div>
      <Button
        size="sm"
        className="mx-2 self-start rounded-full bg-foreground px-4 text-background hover:bg-foreground/85"
        onClick={() => onTry(entry.id)}
      >
        Ausprobieren
        <ArrowRightIcon className="transition-transform group-hover/card:translate-x-0.5" />
      </Button>
    </article>
  );
}
