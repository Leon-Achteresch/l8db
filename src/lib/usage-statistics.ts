export const USAGE_SESSION_LIMIT = 32;
export const USAGE_GROUP_LIMIT = 128;
export const USAGE_FLUSH_MS = 1500;
export const USAGE_STORAGE_PREFIX = "l8db.usage-statistics.session.";
export const USAGE_RESET_KEY = "l8db.usage-statistics.reset";
export const DURATION_BUCKETS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 300000,
];

const VIEW_LABELS: Record<string, string> = {
  home: "Startseite",
  connections: "Verbindungen",
  query: "SQL-Editor",
  tables: "Tabellen",
  dashboard: "Dashboards",
  ai: "KI",
  notebook: "Notebooks",
  workbench: "Workbench",
  "query-builder": "Query Builder",
  "er-diagram": "ER-Diagramm",
  compare: "Vergleich",
  "schema-compare": "Schema-Vergleich",
  versioning: "Versionierung",
  automation: "Automatisierung",
  health: "Datenbankzustand",
  monitor: "Monitor",
  sessions: "Datenbanksitzungen",
  backup: "Backups",
  import: "Import",
  transfer: "Datentransfer",
  buckets: "Objektspeicher",
  baas: "BaaS",
  mcp: "MCP",
  drivers: "Treiber",
  docs: "Dokumentation",
  about: "Über",
  "release-notes": "Release Notes",
  "create-table": "Tabelle erstellen",
  "alter-table": "Tabelle bearbeiten",
  "view-editor": "View-Editor",
  functions: "Funktionen",
  procedures: "Prozeduren",
  packages: "Packages",
  triggers: "Trigger",
  matviews: "Materialisierte Views",
  users: "Datenbanknutzer",
  sequences: "Sequenzen",
  enums: "Enums",
  replication: "Replikation",
  "invalid-objects": "Ungültige Objekte",
  "saved-plan": "Ausführungspläne",
  extensions: "Erweiterungen",
  "available-extensions": "Erweiterungskatalog",
  "extension-panels": "Erweiterungsansichten",
  settings: "Einstellungen",
  "settings.general": "Allgemeine Einstellungen",
  "settings.appearance": "Darstellung",
  "settings.editor": "Editor-Einstellungen",
  "settings.data": "Daten-Einstellungen",
  "settings.security": "Sicherheit",
  "settings.extensions": "Erweiterungseinstellungen",
  "settings.hotkeys": "Tastenkürzel",
  "settings.about": "Über & Updates",
  "settings.statistics": "Nutzungsstatistik",
  other: "Weitere Bereiche",
};
const OPERATION_LABELS: Record<string, string> = {
  query: "SQL-Befehle",
  browse: "Tabellen lesen",
  connect: "Verbindung testen",
  export: "Export",
  import: "Import",
  transfer: "Datentransfer",
  commit: "Commit",
  rollback: "Rollback",
  tunnel: "Tunnelaufbau",
  driver: "Treiberinstallation",
  "user-query": "Abfragen im Editor",
};
const DATABASE_KINDS = new Set([
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "mongodb",
  "redis",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
  "elasticsearch",
  "influxdb",
  "sqlite_http",
  "dynamodb",
  "athena",
  "bigquery",
  "snowflake",
  "s3",
  "unknown",
]);

export type UsageOutcome = "ok" | "error" | "cancelled";
export interface UsageStatistics {
  sessionCount: number;
  startedAt: number | null;
  updatedAt: number | null;
  views: { view: string; opens: number; activeMs: number }[];
  transitions: { from: string; to: string; count: number }[];
  operations: {
    operation: string;
    kind: string;
    ok: number;
    error: number;
    cancelled: number;
    totalMs: number;
    histogram: number[];
  }[];
  startup: { count: number; totalMs: number; histogram: number[] };
}
export type UsageEvent =
  | { type: "view"; view: string }
  | { type: "active"; view: string; ms: number }
  | { type: "transition"; from: string; to: string }
  | { type: "operation"; operation: string; kind: string; status: UsageOutcome; ms: number }
  | { type: "startup"; ms: number };

export function usageViewLabel(view: string): string {
  return Object.hasOwn(VIEW_LABELS, view) ? VIEW_LABELS[view] : VIEW_LABELS.other;
}
export function usageOperationLabel(operation: string): string {
  return Object.hasOwn(OPERATION_LABELS, operation)
    ? OPERATION_LABELS[operation]
    : "Weitere Aktionen";
}
export function normalizeUsageView(route: string): string {
  const parts = route
    .split("/")
    .filter((part) => part && !part.startsWith("_") && !part.startsWith("$"));
  const view = parts[0] ?? "home";
  const key = view === "settings" && parts[1] ? `settings.${parts[1]}` : view;
  return Object.hasOwn(VIEW_LABELS, key) ? key : "other";
}
export function normalizeUsageKind(kind: unknown): string {
  return typeof kind === "string" && DATABASE_KINDS.has(kind) ? kind : "unknown";
}
function histogram(): number[] {
  return Array.from({ length: DURATION_BUCKETS.length + 1 }, () => 0);
}
function emptyStatistics(): UsageStatistics {
  return {
    sessionCount: 0,
    startedAt: null,
    updatedAt: null,
    views: [],
    transitions: [],
    operations: [],
    startup: { count: 0, totalMs: 0, histogram: histogram() },
  };
}
function validNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}
function duration(ms: number): number {
  return Math.min(86400000, Math.round(ms));
}
function addDuration(buckets: number[], ms: number): void {
  const index = DURATION_BUCKETS.findIndex((bound) => ms <= bound);
  buckets[index < 0 ? DURATION_BUCKETS.length : index]++;
}
export function durationPercentile(buckets: readonly number[], percentile: number): number {
  const target = Math.max(
    1,
    Math.ceil(buckets.reduce((sum, count) => sum + count, 0) * percentile),
  );
  let count = 0;
  for (let index = 0; index < buckets.length; index++) {
    count += buckets[index];
    if (count >= target) return DURATION_BUCKETS[index] ?? 86400000;
  }
  return 0;
}
function validHistogram(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.length === DURATION_BUCKETS.length + 1 && value.every(validNumber)
  );
}
function readStatistics(raw: string | null, epoch: string): UsageStatistics | null {
  if (!raw || raw.length > 65536) return null;
  try {
    const envelope = JSON.parse(raw);
    if (envelope.version !== 1 || envelope.epoch !== epoch) return null;
    const data = envelope.data as UsageStatistics;
    if (
      data?.sessionCount !== 1 ||
      !validNumber(data.startedAt) ||
      !validNumber(data.updatedAt) ||
      data.updatedAt > 8640000000000000 ||
      data.startedAt > data.updatedAt
    )
      return null;
    if (
      !Array.isArray(data.views) ||
      data.views.length > USAGE_GROUP_LIMIT ||
      !data.views.every(
        (row) =>
          row &&
          Object.hasOwn(VIEW_LABELS, row.view) &&
          validNumber(row.opens) &&
          validNumber(row.activeMs),
      )
    )
      return null;
    if (
      !Array.isArray(data.transitions) ||
      data.transitions.length > USAGE_GROUP_LIMIT ||
      !data.transitions.every(
        (row) =>
          row &&
          Object.hasOwn(VIEW_LABELS, row.from) &&
          Object.hasOwn(VIEW_LABELS, row.to) &&
          validNumber(row.count),
      )
    )
      return null;
    if (
      !Array.isArray(data.operations) ||
      data.operations.length > USAGE_GROUP_LIMIT ||
      !data.operations.every(
        (row) =>
          row &&
          Object.hasOwn(OPERATION_LABELS, row.operation) &&
          DATABASE_KINDS.has(row.kind) &&
          [row.ok, row.error, row.cancelled, row.totalMs].every(validNumber) &&
          validHistogram(row.histogram),
      )
    )
      return null;
    if (
      !data.startup ||
      ![data.startup.count, data.startup.totalMs].every(validNumber) ||
      !validHistogram(data.startup.histogram)
    )
      return null;
    return {
      sessionCount: 1,
      startedAt: data.startedAt,
      updatedAt: data.updatedAt,
      views: data.views.map(({ view, opens, activeMs }) => ({ view, opens, activeMs })),
      transitions: data.transitions.map(({ from, to, count }) => ({ from, to, count })),
      operations: data.operations.map(
        ({ operation, kind, ok, error, cancelled, totalMs, histogram: buckets }) => ({
          operation,
          kind,
          ok,
          error,
          cancelled,
          totalMs,
          histogram: buckets.slice(),
        }),
      ),
      startup: {
        count: data.startup.count,
        totalMs: data.startup.totalMs,
        histogram: data.startup.histogram.slice(),
      },
    };
  } catch {
    return null;
  }
}
function combine(sessions: UsageStatistics[]): UsageStatistics {
  const result = emptyStatistics();
  const views = new Map<string, UsageStatistics["views"][number]>();
  const transitions = new Map<string, UsageStatistics["transitions"][number]>();
  const operations = new Map<string, UsageStatistics["operations"][number]>();
  for (const session of sessions) {
    if (!session.sessionCount) continue;
    result.sessionCount += session.sessionCount;
    result.startedAt = Math.min(result.startedAt ?? Infinity, session.startedAt ?? Infinity);
    result.updatedAt = Math.max(result.updatedAt ?? 0, session.updatedAt ?? 0);
    for (const row of session.views) {
      const value = views.get(row.view) ?? { view: row.view, opens: 0, activeMs: 0 };
      value.opens += row.opens;
      value.activeMs += row.activeMs;
      views.set(row.view, value);
    }
    for (const row of session.transitions) {
      const key = `${row.from}:${row.to}`;
      const value = transitions.get(key) ?? { from: row.from, to: row.to, count: 0 };
      value.count += row.count;
      if (transitions.has(key) || transitions.size < USAGE_GROUP_LIMIT) transitions.set(key, value);
    }
    for (const row of session.operations) {
      const key = `${row.operation}:${row.kind}`;
      const value = operations.get(key) ?? {
        operation: row.operation,
        kind: row.kind,
        ok: 0,
        error: 0,
        cancelled: 0,
        totalMs: 0,
        histogram: histogram(),
      };
      value.ok += row.ok;
      value.error += row.error;
      value.cancelled += row.cancelled;
      value.totalMs += row.totalMs;
      row.histogram.forEach((count, index) => {
        value.histogram[index] += count;
      });
      operations.set(key, value);
    }
    result.startup.count += session.startup.count;
    result.startup.totalMs += session.startup.totalMs;
    session.startup.histogram.forEach((count, index) => {
      result.startup.histogram[index] += count;
    });
  }
  result.views = [...views.values()].sort((a, b) => b.opens - a.opens);
  result.transitions = [...transitions.values()].sort((a, b) => b.count - a.count);
  result.operations = [...operations.values()].sort(
    (a, b) => b.ok + b.error + b.cancelled - a.ok - a.error - a.cancelled,
  );
  return result;
}

interface StoreOptions {
  storage: Storage | null;
  id?: string;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}
export function createUsageStatisticsStore({
  storage,
  id = `${Date.now()}-${crypto.randomUUID()}`,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}: StoreOptions) {
  const key = `${USAGE_STORAGE_PREFIX}${id}`;
  let epoch = "";
  let current = emptyStatistics();
  let snapshot = emptyStatistics();
  let dirty = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const resetListeners = new Set<() => void>();
  const viewMap = new Map<string, UsageStatistics["views"][number]>();
  const transitionMap = new Map<string, UsageStatistics["transitions"][number]>();
  const operationMap = new Map<string, UsageStatistics["operations"][number]>();
  const keys = () => {
    const found: string[] = [];
    if (storage)
      for (let index = 0; index < storage.length; index++) {
        const candidate = storage.key(index);
        if (candidate?.startsWith(USAGE_STORAGE_PREFIX)) found.push(candidate);
      }
    return found.sort().reverse();
  };
  const resetCurrent = () => {
    current = emptyStatistics();
    viewMap.clear();
    transitionMap.clear();
    operationMap.clear();
    dirty = false;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    for (const listener of resetListeners) listener();
  };
  const checkEpoch = () => {
    const next = storage?.getItem(USAGE_RESET_KEY) ?? "";
    if (next !== epoch) {
      epoch = next;
      resetCurrent();
    }
  };
  const publish = () => {
    let saved: UsageStatistics[] = [];
    try {
      checkEpoch();
      saved = keys()
        .filter((entry) => entry !== key)
        .slice(0, USAGE_SESSION_LIMIT - (current.sessionCount ? 1 : 0))
        .flatMap((entry) => {
          const data = readStatistics(storage?.getItem(entry) ?? null, epoch);
          return data ? [data] : [];
        });
    } catch {
      saved = [];
    }
    snapshot = combine([...saved, current]);
    for (const listener of listeners) listener();
  };
  const flush = () => {
    if (disposed) return;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    try {
      checkEpoch();
      if (dirty && current.sessionCount) {
        storage?.setItem(key, JSON.stringify({ version: 1, epoch, data: current }));
        const retained = [key, ...keys().filter((entry) => entry !== key)];
        for (const entry of retained.slice(USAGE_SESSION_LIMIT)) storage?.removeItem(entry);
      }
    } catch {}
    dirty = false;
    publish();
  };
  const record = (event: UsageEvent) => {
    if (disposed) return;
    try {
      checkEpoch();
    } catch {}
    if (
      (event.type === "active" || event.type === "startup" || event.type === "operation") &&
      !validNumber(event.ms)
    )
      return;
    if (
      event.type === "operation" &&
      (!Object.hasOwn(OPERATION_LABELS, event.operation) ||
        !["ok", "error", "cancelled"].includes(event.status))
    )
      return;
    if (event.type === "view" || event.type === "active") {
      const view = Object.hasOwn(VIEW_LABELS, event.view) ? event.view : "other";
      const row = viewMap.get(view) ?? { view, opens: 0, activeMs: 0 };
      if (!viewMap.has(view)) {
        viewMap.set(view, row);
        current.views.push(row);
      }
      if (event.type === "view") row.opens++;
      else row.activeMs += duration(event.ms);
    } else if (event.type === "transition") {
      const from = Object.hasOwn(VIEW_LABELS, event.from) ? event.from : "other";
      const to = Object.hasOwn(VIEW_LABELS, event.to) ? event.to : "other";
      if (from === to) return;
      const pair = `${from}:${to}`;
      const row = transitionMap.get(pair) ?? { from, to, count: 0 };
      if (!transitionMap.has(pair)) {
        if (transitionMap.size >= USAGE_GROUP_LIMIT) return;
        transitionMap.set(pair, row);
        current.transitions.push(row);
      }
      row.count++;
    } else if (event.type === "operation") {
      const kind = normalizeUsageKind(event.kind);
      const group = `${event.operation}:${kind}`;
      const row = operationMap.get(group) ?? {
        operation: event.operation,
        kind,
        ok: 0,
        error: 0,
        cancelled: 0,
        totalMs: 0,
        histogram: histogram(),
      };
      if (!operationMap.has(group)) {
        if (operationMap.size >= USAGE_GROUP_LIMIT) return;
        operationMap.set(group, row);
        current.operations.push(row);
      }
      row[event.status]++;
      row.totalMs += duration(event.ms);
      addDuration(row.histogram, duration(event.ms));
    } else {
      current.startup.count++;
      current.startup.totalMs += duration(event.ms);
      addDuration(current.startup.histogram, duration(event.ms));
    }
    current.sessionCount = 1;
    current.startedAt ??= now();
    current.updatedAt = now();
    dirty = true;
    if (timer === undefined) timer = schedule(flush, USAGE_FLUSH_MS);
  };
  publish();
  return {
    record,
    flush,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeReset: (listener: () => void) => {
      resetListeners.add(listener);
      return () => {
        resetListeners.delete(listener);
      };
    },
    refresh: publish,
    clear: () => {
      resetCurrent();
      epoch = crypto.randomUUID();
      try {
        storage?.setItem(USAGE_RESET_KEY, epoch);
        for (const entry of keys()) storage?.removeItem(entry);
      } catch {}
      publish();
    },
    dispose: () => {
      flush();
      disposed = true;
      listeners.clear();
      resetListeners.clear();
    },
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
export const usageStatisticsStore = createUsageStatisticsStore({ storage: browserStorage() });
export function clearUsageStatistics(): void {
  usageStatisticsStore.clear();
}
export function exportUsageStatistics(): string {
  usageStatisticsStore.flush();
  return JSON.stringify(
    { version: 1, scope: "local-last-32-window-sessions", ...usageStatisticsStore.getSnapshot() },
    null,
    2,
  );
}
