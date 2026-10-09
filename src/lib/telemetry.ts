import { useSettingsStore } from "@/lib/settings";
import {
  normalizeUsageKind,
  normalizeUsageView,
  type UsageEvent,
  type UsageOutcome,
  usageStatisticsStore,
} from "@/lib/usage-statistics";

type SentryModule = typeof import("@sentry/browser");
type MetricAttributes = Record<string, string>;
type Emit = (client: SentryModule) => void;

const PENDING_LIMIT = 50;

let client: SentryModule | null = null;
let crashClient: SentryModule | null = null;
const pending: Emit[] = [];

export function setTelemetryClient(
  next: SentryModule | null,
  discardPending = true,
  crashes: SentryModule | null = null,
): void {
  client = next;
  crashClient = crashes;
  if (!next) {
    if (discardPending) pending.length = 0;
    return;
  }
  for (const send of pending.splice(0)) if (metricsEnabled()) safely(() => send(next));
}

function metricsEnabled(): boolean {
  return !import.meta.env.DEV && useSettingsStore.getState().usageMetrics;
}

function emit(fn: Emit): void {
  if (!metricsEnabled()) return;
  if (client) safely(() => fn(client as SentryModule));
  else if (pending.length < PENDING_LIMIT) pending.push(fn);
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {}
}

function local(event: UsageEvent): void {
  if (useSettingsStore.getState().localUsageStats) safely(() => usageStatisticsStore.record(event));
}

export function usageTrackingEnabled(): boolean {
  return useSettingsStore.getState().localUsageStats || metricsEnabled();
}

export function recordDuration(name: string, ms: number, attributes: MetricAttributes): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  if (name === "app.startup") local({ type: "startup", ms });
  emit((sentry) =>
    sentry.metrics.distribution(name, Math.round(ms), { unit: "millisecond", attributes }),
  );
}

export function recordCount(name: string, attributes: MetricAttributes): void {
  emit((sentry) => sentry.metrics.count(name, 1, { attributes }));
}

export function recordView(route: string, previous?: string | null): void {
  const view = normalizeUsageView(route);
  const from = previous ? normalizeUsageView(previous) : null;
  local({ type: "view", view });
  recordCount("view.open", { route: view });
  if (from && from !== view) {
    local({ type: "transition", from, to: view });
    recordCount("view.transition", { from, to: view });
  }
}

export function recordViewActivity(view: string, ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const route = normalizeUsageView(view);
  local({ type: "active", view: route, ms });
  recordDuration("view.active.duration", ms, { route });
}

export const USAGE_COMMANDS: Readonly<Record<string, string>> = {
  execute_query: "query",
  execute_query_with_params: "query",
  execute_in_transaction: "query",
  execute_in_transaction_with_params: "query",
  execute_script: "query",
  fetch_table_rows: "browse",
  test_connection: "connect",
  test_connection_string: "connect",
  export_table_csv: "export",
  csv_import: "import",
  copy_table_to_connection: "transfer",
  run_transfer: "transfer",
  commit_transaction: "commit",
  rollback_transaction: "rollback",
  open_ssh_tunnel: "tunnel",
  open_proxy_tunnel: "tunnel",
  install_driver: "driver",
};

export function usageOutcome(error: unknown): UsageOutcome {
  if (error == null) return "ok";
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  if (/timeout|timed out|lock timeout|Zeitüberschreitung/i.test(message)) return "error";
  return /vom Server abgebrochen|bevor sie gestartet|vom Benutzer abgebrochen|zwischen den Statements abgebrochen|cancel(?:led|ed|ing)|SQLSTATE\s*57014|AbortError/i.test(
    message,
  )
    ? "cancelled"
    : "error";
}

export function recordDatabaseOperation(
  command: string,
  kind: unknown,
  status: UsageOutcome,
  ms: number,
): void {
  if (
    !Object.hasOwn(USAGE_COMMANDS, command) ||
    !["ok", "error", "cancelled"].includes(status) ||
    !Number.isFinite(ms) ||
    ms < 0
  )
    return;
  const operation = USAGE_COMMANDS[command];
  const family = normalizeUsageKind(kind);
  local({ type: "operation", operation, kind: family, status, ms });
  const attributes = { command, operation, kind: family, status };
  recordCount("db.command.count", attributes);
  recordDuration("db.command.duration", ms, attributes);
}

export function recordUserQueryOutcome(kind: unknown, error: unknown, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const family = normalizeUsageKind(kind);
  const status = usageOutcome(error);
  local({ type: "operation", operation: "user-query", kind: family, status, ms });
  const attributes = { kind: family, status };
  recordCount("user.query.count", attributes);
  recordDuration("user.query.duration", ms, attributes);
}

export function trackRoute(route: string): void {
  crashClient?.addBreadcrumb({ category: "navigation", message: route });
  emit((sentry) => {
    const sentryClient = sentry.getClient();
    if (sentryClient)
      sentry.startBrowserTracingNavigationSpan(sentryClient, {
        name: route,
        attributes: { "sentry.source": "route" },
      });
  });
}

export function traceCommand<T>(
  command: string,
  attributes: MetricAttributes,
  run: () => Promise<T>,
): Promise<T> {
  crashClient?.addBreadcrumb({ category: "tauri.invoke", message: command, data: attributes });
  if (!client || !metricsEnabled()) return run();
  return client.startSpan({ op: "tauri.invoke", name: command, attributes }, run);
}
