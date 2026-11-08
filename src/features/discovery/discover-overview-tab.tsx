import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { DiscoverFeatureCard } from "@/features/discovery/discover-feature-card";
import { useActiveCapabilities } from "@/lib/db-selection";
import { FEATURE_CATALOG, featureAvailable, newestFeatures } from "@/lib/discovery/catalog";
import { useFeatureUsage } from "@/lib/discovery/usage";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useSettingsStore } from "@/lib/settings";

export function DiscoverOverviewTab() {
  const capabilities = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const usage = useFeatureUsage();
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.overview");
  const available = useMemo(
    () => FEATURE_CATALOG.filter((entry) => featureAvailable(entry, { capabilities, easyMode })),
    [capabilities, easyMode],
  );
  const newest = useMemo(() => newestFeatures(6, available), [available]);
  const major = useMemo(() => available.filter((entry) => entry.size === "major"), [available]);

  return (
    <div ref={ref} className="space-y-8" data-feature="discover.overview">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          Neu
          {isNew && <NewBadge />}
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {newest.map((feature) => (
            <DiscoverFeatureCard
              key={feature.id}
              feature={feature}
              used={usage[feature.id] !== undefined}
            />
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Große Funktionen</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {major.map((feature) => (
            <DiscoverFeatureCard
              key={feature.id}
              feature={feature}
              used={usage[feature.id] !== undefined}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
