import { useEffect, useState } from "react";
import { VideoTooltipCard } from "@/features/discovery/video-tooltips/video-tooltip-card";
import { featureById } from "@/lib/discovery/catalog";
import type { FeatureEntry } from "@/lib/discovery/types";
import {
  blockingOverlayOpen,
  createVideoTooltipController,
  installVideoTooltips,
} from "@/lib/discovery/video-tooltips/controller";
import { resolveClip } from "@/lib/discovery/video-tooltips/media";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useSettingsStore } from "@/lib/settings";

export function VideoTooltipHost() {
  const enabled = useSettingsStore(
    (state) =>
      state.discovery?.enabled !== false && state.discovery?.channels.videoTooltips !== false,
  );
  const [shown, setShown] = useState<{ entry: FeatureEntry; rect: DOMRect } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = createVideoTooltipController({
      hasClip: (id) =>
        resolveClip(featureById(id)?.videoId, useFeatureVideoStore.getState().feed, false) !== null,
      blocked: () => blockingOverlayOpen(),
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
