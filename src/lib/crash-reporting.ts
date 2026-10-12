import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { redactErrorMessage } from "@/lib/diagnostics/redact";
import { useSettingsStore } from "@/lib/settings";
import { setTelemetryClient } from "@/lib/telemetry";

const SENTRY_DSN =
  "https://a0ed238540409e2a6ac907ef008a6ecd@o4512165553635328.ingest.de.sentry.io/4512165557436496";

const TRACES_SAMPLE_RATE = 0.2;

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
  setTelemetryClient(null, !usageMetrics);
  queue = queue
    .then(async () => {
      await invoke("set_crash_reporting", { enabled: crashReports }).catch(() => undefined);
      await sentry?.close();
      if (
        useSettingsStore.getState().crashReports !== crashReports ||
        useSettingsStore.getState().usageMetrics !== usageMetrics
      )
        return;
      if (!crashReports && !usageMetrics) return;
      sentry ??= await import("@sentry/browser");
      sentry.init({
        dsn: SENTRY_DSN,
        release: `l8db@${await getVersion().catch(() => "unknown")}`,
        environment: "production",
        maxBreadcrumbs: crashReports ? 50 : 0,
        tracesSampleRate: usageMetrics ? TRACES_SAMPLE_RATE : undefined,
        integrations: (defaults) => [
          ...defaults.filter(
            (integration) =>
              integration.name !== "Breadcrumbs" &&
              (usageMetrics || integration.name !== "BrowserSession"),
          ),
          ...(usageMetrics && sentry
            ? [
                sentry.browserTracingIntegration({
                  instrumentNavigation: false,
                  traceFetch: false,
                  traceXHR: false,
                  linkPreviousTrace: "off",
                  beforeStartSpan: (options) => ({ ...options, name: "app.load" }),
                }),
              ]
            : []),
          ...(crashReports && sentry
            ? [sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })]
            : []),
        ],
        beforeSend: (event) =>
          useSettingsStore.getState().crashReports ? scrubEvent(event) : null,
        beforeSendTransaction: (event) =>
          useSettingsStore.getState().usageMetrics ? scrubTransaction(event) : null,
        beforeSendLog: (log) => (useSettingsStore.getState().crashReports ? scrubLog(log) : null),
        beforeSendMetric: (metric) => (useSettingsStore.getState().usageMetrics ? metric : null),
      });
      setTelemetryClient(usageMetrics ? sentry : null, true, crashReports ? sentry : null);
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

function scrubText(value: string): string {
  return redactErrorMessage(value.replace(/\[[^\]]*\]/g, ""));
}

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const [key, value] of Object.entries(data))
    if (typeof value === "string") data[key] = scrubText(value);
}

export function scrubTransaction<
  T extends {
    request?: unknown;
    user?: unknown;
    contexts?: { trace?: { data?: Record<string, unknown> } };
    spans?: { description?: string; data?: Record<string, unknown> }[];
  },
>(event: T): T {
  delete event.request;
  delete event.user;
  scrubData(event.contexts?.trace?.data);
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubText(span.description);
    scrubData(span.data);
  }
  return event;
}

export function scrubLog<T extends { message: unknown; attributes?: Record<string, unknown> }>(
  log: T,
): T {
  log.message = redactErrorMessage(String(log.message));
  if (log.attributes)
    for (const key of Object.keys(log.attributes))
      if (key.startsWith("sentry.message")) delete log.attributes[key];
  return log;
}
