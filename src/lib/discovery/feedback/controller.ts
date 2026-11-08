import { type RetryOptions, releaseChannel, retrySurface } from "../promoter/retry-surface";
import { onFeatureUsed } from "../usage";
import { shouldAskFeedback, useFeedbackStore } from "./store";

export const FEEDBACK_PRIORITY = 2;

export function installFeedback(retry?: RetryOptions): () => void {
  let cancelPending: (() => void) | null = null;
  const stop = onFeatureUsed((id, entry) => {
    const store = useFeedbackStore.getState();
    if (store.active || !shouldAskFeedback(id, entry.count, store.asked)) return;
    cancelPending?.();
    cancelPending = retrySurface(
      { channel: "feedback", id, priority: FEEDBACK_PRIORITY },
      () => {
        cancelPending = null;
        useFeedbackStore.getState().markAsked(id);
      },
      retry,
    );
  });
  return () => {
    stop();
    cancelPending?.();
    cancelPending = null;
    releaseChannel("feedback");
  };
}
