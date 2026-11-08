import { FeatureClip } from "@/features/discovery/video-tooltips/feature-clip";
import { featureById } from "@/lib/discovery/catalog";

export function FeatureEmptyStateClip({ featureId }: { featureId: string }) {
  const entry = featureById(featureId);
  if (!entry?.videoId) return null;
  return <FeatureClip videoId={entry.videoId} title={entry.title} className="w-56" />;
}
