import type { Capabilities } from "@/lib/db";
import { type FeatureEvent, onFeatureEvent } from "../events";
import { useFeatureUsageStore } from "../usage";
import { evaluatePromoterRules, pushPromoterEvent } from "./engine";
import { type RetryOptions, releaseChannel, retrySurface } from "./retry-surface";
import { usePromoterStore } from "./store";

export const PROMOTER_PRIORITY = 3;

export interface DiscoveryContext {
  capabilities: Capabilities | null;
  easyMode: boolean;
}

export function installPromoter(
  getContext: () => DiscoveryContext,
  retry?: RetryOptions,
): () => void {
  const events: FeatureEvent[] = [];
  let cancelPending: (() => void) | null = null;
  const onEvent = (event: FeatureEvent) => {
    if (!pushPromoterEvent(events, event)) return;
    const store = usePromoterStore.getState();
    const matches = evaluatePromoterRules(events, useFeatureUsageStore.getState().usage, event.at, {
      stats: store.stats,
      ...getContext(),
    });
    let rule: (typeof matches)[number] | undefined;
    for (const candidate of matches) {
      if (usePromoterStore.getState().hit(candidate.id, event.at)) rule ??= candidate;
    }
    if (!rule || store.active) return;
    cancelPending?.();
    cancelPending = retrySurface(
      { channel: "promoter", id: rule.id, priority: PROMOTER_PRIORITY },
      () => {
        cancelPending = null;
        usePromoterStore.getState().markShown(rule.id);
      },
      retry,
    );
  };
  const stop = onFeatureEvent(onEvent);
  return () => {
    stop();
    cancelPending?.();
    cancelPending = null;
    events.length = 0;
    releaseChannel("promoter");
  };
}
