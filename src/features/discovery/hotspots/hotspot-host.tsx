import { useEffect, useMemo, useState } from "react";
import { HotspotDot } from "@/features/discovery/hotspots/hotspot-dot";
import { FEATURE_CATALOG, featureAnchorId } from "@/lib/discovery/catalog";
import { useActiveSurface } from "@/lib/discovery/coordinator";
import { findAnchor, isAnchorVisible } from "@/lib/discovery/highlight";
import { hotspotCandidates } from "@/lib/discovery/hotspots/model";
import { useHotspotStore } from "@/lib/discovery/hotspots/store";
import { watchHotspot } from "@/lib/discovery/hotspots/track";
import type { FeatureEntry } from "@/lib/discovery/types";
import { useFeatureUsage } from "@/lib/discovery/usage";
import { useSettingsStore } from "@/lib/settings";
import { useTourStore } from "@/lib/tour/store";
import { getAppVersion } from "@/lib/updater";

function visibleAnchor(entry: FeatureEntry): HTMLElement | null {
  const element = findAnchor(featureAnchorId(entry));
  return element && isAnchorVisible(element) ? element : null;
}

export function HotspotHost() {
  const usage = useFeatureUsage();
  const dismissed = useHotspotStore((state) => state.dismissed);
  const easyMode = useSettingsStore((state) => state.easyMode);
  const enabled = useSettingsStore(
    (state) =>
      state.onboardingDone &&
      state.discovery?.enabled !== false &&
      state.discovery?.channels.hotspots !== false,
  );
  const touring = useTourStore((state) => state.active || state.offerOpen);
  const active = useActiveSurface();
  const [version, setVersion] = useState<string | null>(null);
  const [target, setTarget] = useState<{ entry: FeatureEntry; element: HTMLElement } | null>(null);

  useEffect(() => {
    let alive = true;
    void getAppVersion().then((value) => {
      if (alive) setVersion(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const candidates = useMemo(
    () =>
      enabled && !touring
        ? hotspotCandidates(FEATURE_CATALOG, { usage, dismissed, version, easyMode })
        : [],
    [enabled, touring, usage, dismissed, version, easyMode],
  );

  useEffect(() => watchHotspot(candidates, visibleAnchor, setTarget), [candidates]);

  if (!target) return null;
  return (
    <HotspotDot
      key={target.entry.id}
      entry={target.entry}
      element={target.element}
      hidden={active !== null && active.channel !== "hotspots"}
    />
  );
}
