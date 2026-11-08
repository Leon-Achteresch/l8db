import { NewBadge } from "@/components/new-badge";
import { FeatureClip } from "@/features/discovery/video-tooltips/feature-clip";
import type { FeatureEntry } from "@/lib/discovery/types";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const WIDTH = 240;
const GAP = 8;

export function VideoTooltipCard({ entry, rect }: { entry: FeatureEntry; rect: DOMRect }) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.video-tooltips");
  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - WIDTH - GAP));
  const below = rect.bottom + GAP + 180 < window.innerHeight;
  return (
    <div
      ref={ref}
      role="tooltip"
      data-video-tooltip
      className="pointer-events-none fixed z-50 flex flex-col gap-2 rounded-2xl bg-popover p-2 text-popover-foreground shadow-xl shadow-foreground/10"
      style={{
        width: WIDTH,
        left,
        ...(below ? { top: rect.bottom + GAP } : { bottom: window.innerHeight - rect.top + GAP }),
      }}
    >
      <FeatureClip videoId={entry.videoId} title={entry.title} />
      <p className="flex items-center gap-1.5 px-1 text-xs font-medium">
        {entry.title}
        {isNew && <NewBadge />}
      </p>
    </div>
  );
}
