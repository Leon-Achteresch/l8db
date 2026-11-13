import { AnimatePresence } from "motion/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useActiveCapabilities } from "@/lib/db-selection";
import { featureById } from "@/lib/discovery/catalog";
import { releaseSurface, useActiveSurface } from "@/lib/discovery/coordinator";
import { highlightFeature } from "@/lib/discovery/highlight";
import type { DiscoveryContext } from "@/lib/discovery/promoter/controller";
import { installRelated } from "@/lib/discovery/related/controller";
import { useRelatedStore } from "@/lib/discovery/related/store";
import { useSettingsStore } from "@/lib/settings";
import { DiscoveryCard } from "../promoter/discovery-card";

const VISIBLE_MS = 15_000;

export default function RelatedHost() {
  const capabilities = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const context = useRef<DiscoveryContext>({ capabilities, easyMode });
  context.current = { capabilities, easyMode };
  const active = useRelatedStore((state) => state.active);
  const surface = useActiveSurface();

  useEffect(() => installRelated(() => context.current), []);

  const entry = active ? featureById(active.to) : undefined;
  const visible = Boolean(
    active && entry && surface?.channel === "related" && surface.id === active.pair,
  );

  useEffect(() => {
    if (active && !visible) useRelatedStore.getState().dismiss();
  }, [active, visible]);

  const close = (show: boolean) => {
    if (!active) return;
    useRelatedStore.getState().dismiss();
    releaseSurface("related", active.pair);
    if (show) void highlightFeature(active.to);
  };

  return (
    <AnimatePresence>
      {visible && active && entry ? (
        <DiscoveryCard
          key={active.pair}
          label="Passt dazu"
          title={entry.title}
          summary={entry.summary}
          featureId="discover.related"
          autoCloseMs={VISIBLE_MS}
          onClose={() => close(false)}
        >
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => close(true)}>
            Zeigen
          </Button>
        </DiscoveryCard>
      ) : null}
    </AnimatePresence>
  );
}
