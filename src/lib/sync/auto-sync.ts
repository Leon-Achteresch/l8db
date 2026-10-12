export const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const MIN_INTERVAL_MS = 15 * 60 * 1000;

export function autoSyncPlan(config: {
  autoSync: boolean;
  configured: boolean;
  intervalMinutes: number;
}): { intervalMs: number } | null {
  if (!config.autoSync || !config.configured) return null;
  const minutes = Number.isFinite(config.intervalMinutes) ? config.intervalMinutes : 0;
  return { intervalMs: Math.max(MIN_INTERVAL_MS, Math.round(minutes) * 60_000) };
}

export interface AutoSyncOptions {
  intervalMs: number;
  syncOnStart: boolean;
  claim: () => Promise<boolean>;
  release: () => Promise<void>;
  run: (signal: AbortSignal) => Promise<void>;
  schedule?: (callback: () => void, ms: number) => unknown;
  clear?: (handle: unknown) => void;
  maxBackoffMs?: number;
}

export function backoffDelay(intervalMs: number, failures: number, maxMs = MAX_BACKOFF_MS) {
  if (failures <= 0) return intervalMs;
  return Math.min(maxMs, intervalMs * 2 ** Math.min(failures, 16));
}

export function startAutoSync({
  intervalMs,
  syncOnStart,
  claim,
  release,
  run,
  schedule = (callback, ms) => window.setTimeout(callback, ms),
  clear = (handle) => window.clearTimeout(handle as number),
  maxBackoffMs = MAX_BACKOFF_MS,
}: AutoSyncOptions): () => void {
  let stopped = false;
  let failures = 0;
  let handle: unknown;
  let controller: AbortController | null = null;
  let claimed = false;
  const plan = (ms: number) => {
    if (!stopped) handle = schedule(() => void tick(), ms);
  };
  const tick = async () => {
    handle = undefined;
    if (stopped) return;
    let failed = false;
    try {
      claimed = await claim();
      if (claimed && !stopped) {
        controller = new AbortController();
        await run(controller.signal);
      }
    } catch {
      failed = true;
    } finally {
      controller = null;
    }
    failures = failed ? failures + 1 : 0;
    plan(backoffDelay(intervalMs, failures, maxBackoffMs));
  };
  if (syncOnStart) void tick();
  else plan(intervalMs);
  return () => {
    stopped = true;
    if (handle !== undefined) clear(handle);
    handle = undefined;
    controller?.abort();
    if (claimed) void release().catch(() => undefined);
  };
}
