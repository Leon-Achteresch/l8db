import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const ABANDON_GRACE_MS = 3_000;

export function runUntilAbandoned<T>(
  { client, queryKey }: { client: QueryClient; queryKey: QueryKey },
  run: (jobId: string) => Promise<T>,
  cancel: (jobId: string) => void,
  graceMs = ABANDON_GRACE_MS,
): Promise<T> {
  const jobId = crypto.randomUUID();
  const cache = client.getQueryCache();
  const query = cache.find({ queryKey, exact: true });
  if (!query) return run(jobId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const abandon = () => {
    if (done) return;
    done = true;
    cancel(jobId);
  };
  const check = () => {
    clearTimeout(timer);
    if (query.state.fetchStatus === "idle" || cache.get(query.queryHash) !== query) {
      abandon();
    } else if (query.getObserversCount() === 0) {
      timer = setTimeout(() => {
        if (query.getObserversCount() === 0) abandon();
      }, graceMs);
    }
  };
  const unsubscribe = cache.subscribe((event) => {
    if (event.query === query) check();
  });
  check();
  return run(jobId).finally(() => {
    done = true;
    clearTimeout(timer);
    unsubscribe();
  });
}
