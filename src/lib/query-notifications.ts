export const QUERY_NOTIFICATION_THRESHOLD_MS = 10_000;
export type QueryCompletion = "success" | "error" | "cancelled";

export function createQueryCompletion(
  enabled: () => boolean,
  background: () => boolean,
  send: (outcome: "success" | "error", durationMs: number) => Promise<void>,
  now = () => performance.now(),
) {
  const startedAt = now();
  let finished = false;
  return async (outcome: QueryCompletion) => {
    if (finished) return;
    finished = true;
    const durationMs = Math.round(now() - startedAt);
    if (
      outcome === "cancelled" ||
      durationMs < QUERY_NOTIFICATION_THRESHOLD_MS ||
      !enabled() ||
      !background()
    )
      return;
    await send(outcome, durationMs);
  };
}
