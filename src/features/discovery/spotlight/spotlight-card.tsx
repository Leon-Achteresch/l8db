import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureClip } from "@/features/discovery/video-tooltips/feature-clip";
import type { FeatureEntry } from "@/lib/discovery/types";

export function SpotlightCard({
  entry,
  onTry,
}: {
  entry: FeatureEntry;
  onTry: (id: string) => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-3">
      <FeatureClip videoId={entry.videoId} title={entry.title} />
      <div className="flex flex-1 flex-col gap-1 px-1">
        <h3 className="text-sm font-semibold">{entry.title}</h3>
        <p className="text-xs text-muted-foreground">{entry.summary}</p>
      </div>
      <Button size="sm" className="self-start" onClick={() => onTry(entry.id)}>
        Ausprobieren
        <ArrowRightIcon />
      </Button>
    </article>
  );
}
