import { releaseSurface } from "../coordinator";
import type { DiscoveryContext } from "../promoter/controller";
import { type RetryOptions, retrySurface } from "../promoter/retry-surface";
import { onFeatureUsed, useFeatureUsageStore } from "../usage";
import { relatedSuggestion, useRelatedStore } from "./store";

export const RELATED_PRIORITY = 1;
export const RELATED_TTL_MS = 5 * 60_000;

export function installRelated(
  getContext: () => DiscoveryContext,
  retry: RetryOptions = { ttlMs: RELATED_TTL_MS },
): () => void {
  let cancelPending: (() => void) | null = null;
  const stop = onFeatureUsed((id) => {
    const store = useRelatedStore.getState();
    if (store.active) return;
    const suggestion = relatedSuggestion(
      id,
      useFeatureUsageStore.getState().usage,
      store.shown,
      getContext(),
    );
    if (!suggestion) return;
    cancelPending?.();
    cancelPending = retrySurface(
      { channel: "related", id: suggestion.pair, priority: RELATED_PRIORITY },
      () => {
        cancelPending = null;
        if (useFeatureUsageStore.getState().usage[suggestion.to])
          return releaseSurface("related", suggestion.pair);
        useRelatedStore.getState().markShown(suggestion);
      },
      retry,
    );
  });
  return () => {
    stop();
    cancelPending?.();
    cancelPending = null;
  };
}
