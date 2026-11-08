import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { AtlasView } from "@/features/discovery/atlas/atlas-view";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { atlasAvailable } from "@/lib/discovery/atlas/atlas";
import { FEATURE_CATALOG } from "@/lib/discovery/catalog";
import { useFeatureUsage } from "@/lib/discovery/usage";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useSettingsStore } from "@/lib/settings";

export function AtlasTab() {
  const connected = useActiveConnection() !== null;
  const activeCapabilities = useActiveCapabilities();
  const capabilities = connected ? activeCapabilities : undefined;
  const easyMode = useSettingsStore((state) => state.easyMode);
  const usage = useFeatureUsage();
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.atlas");
  const available = useMemo(
    () => atlasAvailable(FEATURE_CATALOG, { capabilities, easyMode }),
    [capabilities, easyMode],
  );

  return (
    <div ref={ref} data-feature="discover.atlas" className="relative">
      {isNew && <NewBadge className="absolute top-0 right-0" />}
      <AtlasView available={available} usage={usage} />
    </div>
  );
}
