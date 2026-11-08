import { useEffect, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { releaseSurface, requestSurface } from "@/lib/discovery/coordinator";
import { highlightFeature } from "@/lib/discovery/highlight";
import { useHotspotStore } from "@/lib/discovery/hotspots/store";
import { type AnchorRect, trackAnchor } from "@/lib/discovery/hotspots/track";
import type { FeatureEntry } from "@/lib/discovery/types";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const SIZE = 10;

export function HotspotDot({
  entry,
  element,
  hidden,
}: {
  entry: FeatureEntry;
  element: Element;
  hidden: boolean;
}) {
  const [rect, setRect] = useState<AnchorRect | null>(null);
  const [open, setOpen] = useState(false);
  const dismiss = useHotspotStore((state) => state.dismiss);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.hotspots");

  useEffect(() => trackAnchor(element, setRect), [element]);
  useEffect(() => () => releaseSurface("hotspots", entry.id), [entry.id]);

  const change = (next: boolean) => {
    if (
      next &&
      !requestSurface({ channel: "hotspots", id: entry.id, priority: 40, explicit: true })
    )
      return;
    if (!next) releaseSurface("hotspots", entry.id);
    setOpen(next);
  };

  if (!rect || (hidden && !open)) return null;
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Neu: ${entry.title}`}
          className="fixed z-40 grid cursor-pointer place-items-center rounded-full transition-transform hover:scale-125 active:scale-95"
          style={{
            top: rect.top - SIZE / 2,
            left: rect.left + rect.width - SIZE / 2,
            width: SIZE,
            height: SIZE,
          }}
        >
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60 forced-color-adjust-none motion-reduce:animate-none forced-colors:bg-[color:Highlight]" />
          <span className="relative inline-flex size-full rounded-full bg-primary forced-color-adjust-none forced-colors:bg-[color:Highlight]" />
        </button>
      </PopoverTrigger>
      <PopoverContent ref={ref} side="bottom" align="end" className="w-64 gap-3 p-3">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {entry.title}
            {isNew && <NewBadge />}
          </p>
          <p className="text-xs text-muted-foreground">{entry.summary}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              change(false);
              dismiss(entry.id);
            }}
          >
            Ausblenden
          </Button>
          <Button
            size="sm"
            onClick={() => {
              change(false);
              void highlightFeature(entry.id);
            }}
          >
            Ausprobieren
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
