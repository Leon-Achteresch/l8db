import { useEffect, useState } from "react";
import { VideoTooltipCard } from "@/features/discovery/video-tooltips/video-tooltip-card";
import { featureById } from "@/lib/discovery/catalog";
import type { FeatureEntry } from "@/lib/discovery/types";
import {
  BLOCKING_OVERLAYS,
  createVideoTooltipController,
  installVideoTooltips,
} from "@/lib/discovery/video-tooltips/controller";
import { useSettingsStore } from "@/lib/settings";

function overlayOpen(): boolean {
  for (const node of document.querySelectorAll(BLOCKING_OVERLAYS))
    if (node.getClientRects().length > 0) return true;
  return false;
}

export function VideoTooltipHost() {
  const enabled = useSettingsStore(
    (state) =>
      state.discovery?.enabled !== false && state.discovery?.channels.videoTooltips !== false,
  );
  const [shown, setShown] = useState<{ entry: FeatureEntry; rect: DOMRect } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = createVideoTooltipController({
      hasClip: (id) => Boolean(featureById(id)?.videoId),
      blocked: overlayOpen,
      onChange: (target) => {
        const entry = target ? featureById(target.id) : undefined;
        setShown(target && entry ? { entry, rect: target.element.getBoundingClientRect() } : null);
      },
    });
    const stop = installVideoTooltips(controller);
    return () => {
      stop();
      setShown(null);
    };
  }, [enabled]);

  if (!shown) return null;
  return <VideoTooltipCard key={shown.entry.id} entry={shown.entry} rect={shown.rect} />;
}
