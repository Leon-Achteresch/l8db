import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { NewFeatureId } from "@/lib/new-features";

export function HotkeyNewBadge({ featureId }: { featureId: NewFeatureId }) {
  const feature = useNewFeatureVisibility<HTMLSpanElement>(featureId);
  return (
    <span ref={feature.ref} className="ml-2 inline-flex align-middle">
      {feature.isNew && <NewBadge />}
    </span>
  );
}
