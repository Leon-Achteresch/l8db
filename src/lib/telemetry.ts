import { useSettingsStore } from "@/lib/settings";

type SentryModule = typeof import("@sentry/browser");
type MetricAttributes = Record<string, string>;
type Emit = (client: SentryModule) => void;

const PENDING_LIMIT = 50;

let client: SentryModule | null = null;
const pending: Emit[] = [];

export function setTelemetryClient(next: SentryModule | null): void {
  client = next;
  if (!next) {
    pending.length = 0;
    return;
  }
  for (const emit of pending.splice(0)) emit(next);
}

function metricsEnabled(): boolean {
  return !import.meta.env.DEV && useSettingsStore.getState().usageMetrics;
}

function emit(fn: Emit): void {
  if (!metricsEnabled()) return;
  if (client) fn(client);
  else if (pending.length < PENDING_LIMIT) pending.push(fn);
}

export function recordDuration(name: string, ms: number, attributes: MetricAttributes): void {
  emit((sentry) =>
    sentry.metrics.distribution(name, Math.round(ms), { unit: "millisecond", attributes }),
  );
}

export function recordCount(name: string, attributes: MetricAttributes): void {
  emit((sentry) => sentry.metrics.count(name, 1, { attributes }));
}
