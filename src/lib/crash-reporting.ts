import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { redactErrorMessage } from "@/lib/diagnostics/redact";
import { useSettingsStore } from "@/lib/settings";
import { setTelemetryClient } from "@/lib/telemetry";

const SENTRY_DSN =
  "https://a0ed238540409e2a6ac907ef008a6ecd@o4512165553635328.ingest.de.sentry.io/4512165557436496";

type SentryModule = typeof import("@sentry/browser");

let sentry: SentryModule | null = null;
let queue = Promise.resolve();

export function initCrashReporting(): () => void {
  if (import.meta.env.DEV) return () => undefined;
  const { crashReports, usageMetrics } = useSettingsStore.getState();
  apply(crashReports, usageMetrics);
  return useSettingsStore.subscribe((state, previous) => {
    if (
      state.crashReports !== previous.crashReports ||
      state.usageMetrics !== previous.usageMetrics
    )
      apply(state.crashReports, state.usageMetrics);
  });
}

export function reportCrash(error: unknown): void {
  if (useSettingsStore.getState().crashReports) sentry?.captureException(error);
}

function apply(crashReports: boolean, usageMetrics: boolean): void {
  queue = queue
    .then(async () => {
      await invoke("set_crash_reporting", { enabled: crashReports }).catch(() => undefined);
      setTelemetryClient(null);
      await sentry?.close();
      if (!crashReports && !usageMetrics) return;
      sentry ??= await import("@sentry/browser");
      sentry.init({
        dsn: SENTRY_DSN,
        release: `l8db@${await getVersion().catch(() => "unknown")}`,
        environment: "production",
        maxBreadcrumbs: 0,
        integrations: (defaults) =>
          defaults.filter((integration) => usageMetrics || integration.name !== "BrowserSession"),
        beforeSend: (event) => (crashReports ? scrubEvent(event) : null),
        beforeSendMetric: (metric) => (usageMetrics ? metric : null),
      });
      if (usageMetrics) setTelemetryClient(sentry);
    })
    .catch(() => undefined);
}

export function scrubEvent<
  T extends {
    message?: string;
    request?: unknown;
    user?: unknown;
    exception?: { values?: { type?: string; value?: string }[] };
  },
>(event: T): T | null {
  const values = event.exception?.values ?? [];
  if (values.some((value) => value.type === "UnhandledRejection")) return null;
  for (const value of values) {
    if (value.value) value.value = redactErrorMessage(value.value);
  }
  if (event.message) event.message = redactErrorMessage(event.message);
  delete event.request;
  delete event.user;
  return event;
}
