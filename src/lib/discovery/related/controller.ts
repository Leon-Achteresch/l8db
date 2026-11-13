import type { DiscoveryContext } from "../promoter/controller";
import {
  attemptSurface,
  type RetryOptions,
  releaseChannel,
  retrySurface,
} from "../promoter/retry-surface";
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
    const attempt = retry.attempt ?? attemptSurface;
    cancelPending = retrySurface(
      { channel: "related", id: suggestion.pair, priority: RELATED_PRIORITY },
      () => {
        cancelPending = null;
        useRelatedStore.getState().markShown(suggestion);
      },
      {
        ...retry,
        attempt: (request) =>
          useFeatureUsageStore.getState().usage[suggestion.to] ? "stop" : attempt(request),
      },
    );
  });
  return () => {
    stop();
    cancelPending?.();
    cancelPending = null;
    releaseChannel("related");
  };
}
