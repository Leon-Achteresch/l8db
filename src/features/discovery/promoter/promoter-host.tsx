import { AnimatePresence } from "motion/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useActiveCapabilities } from "@/lib/db-selection";
import { featureById } from "@/lib/discovery/catalog";
import { releaseSurface, useActiveSurface } from "@/lib/discovery/coordinator";
import { highlightFeature } from "@/lib/discovery/highlight";
import { type DiscoveryContext, installPromoter } from "@/lib/discovery/promoter/controller";
import { PROMOTER_RULES } from "@/lib/discovery/promoter/rules";
import { usePromoterStore } from "@/lib/discovery/promoter/store";
import { useSettingsStore } from "@/lib/settings";
import { DiscoveryCard } from "./discovery-card";

const VISIBLE_MS = 20_000;

export default function PromoterHost() {
  const capabilities = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const context = useRef<DiscoveryContext>({ capabilities, easyMode });
  context.current = { capabilities, easyMode };
  const activeId = usePromoterStore((state) => state.active);
  const surface = useActiveSurface();

  useEffect(() => installPromoter(() => context.current), []);

  const rule = PROMOTER_RULES.find((candidate) => candidate.id === activeId);
  const entry = rule ? featureById(rule.featureId) : undefined;
  const visible = Boolean(
    rule && entry && surface?.channel === "promoter" && surface.id === rule.id,
  );

  useEffect(() => {
    if (activeId && !visible) usePromoterStore.getState().dismiss();
  }, [activeId, visible]);

  const close = (action: "later" | "mute" | "accept") => {
    if (!rule) return;
    const store = usePromoterStore.getState();
    if (action === "mute") store.mute(rule.id);
    else if (action === "accept") store.accept(rule.id);
    else store.dismiss();
    releaseSurface("promoter", rule.id);
    if (action === "accept") void highlightFeature(rule.featureId);
  };

  return (
    <AnimatePresence>
      {visible && rule && entry ? (
        <DiscoveryCard
          key={rule.id}
          label={rule.reason}
          title={entry.title}
          summary={entry.summary}
          featureId="discover.promoter"
          autoCloseMs={VISIBLE_MS}
          onClose={() => close("later")}
        >
          <div className="flex items-center gap-1">
            <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => close("accept")}>
              Zeigen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => close("later")}
            >
              Später
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-xs text-muted-foreground"
              onClick={() => close("mute")}
            >
              Nicht mehr vorschlagen
            </Button>
          </div>
        </DiscoveryCard>
      ) : null}
    </AnimatePresence>
  );
}
