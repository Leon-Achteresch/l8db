import type { ConvexLogEntry, ConvexLogLine } from "@/lib/db/convex-studio-logs";

export const LOG_BUFFER_LIMIT = 1000;
export const LOG_LINE_LIMIT = 200;
export const LOG_LEVELS = ["DEBUG", "LOG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogStatus = "all" | "success" | "failure" | "running";

export interface ConvexExecution {
  key: string;
  executionId: string;
  requestId: string;
  identifier: string;
  udfType: string;
  componentPath: string | null;
  caller: string | null;
  parentExecutionId: string | null;
  startedMs: number;
  timestampMs: number;
  completed: boolean;
  success: boolean | null;
  error: string | null;
  cached: boolean;
  executionTimeMs: number | null;
  userExecutionTimeMs: number | null;
  usage: Record<string, number> | null;
  returnBytes: number | null;
  environment: string | null;
  lines: ConvexLogLine[];
  linesDropped: number;
}

export interface LogFilters {
  identifier: string;
  levels: LogLevel[];
  status: LogStatus;
  search: string;
}

export const DEFAULT_LOG_FILTERS: LogFilters = {
  identifier: "all",
  levels: [...LOG_LEVELS],
  status: "all",
  search: "",
};

function boundLines(lines: ConvexLogLine[], dropped: number) {
  const extra = Math.max(0, lines.length - LOG_LINE_LIMIT);
  return { lines: extra ? lines.slice(extra) : lines, linesDropped: dropped + extra };
}

function fromEntry(key: string, entry: ConvexLogEntry): ConvexExecution {
  return {
    key,
    executionId: entry.executionId,
    requestId: entry.requestId,
    identifier: entry.identifier,
    udfType: entry.udfType,
    componentPath: entry.componentPath,
    caller: entry.caller,
    parentExecutionId: entry.parentExecutionId,
    startedMs: entry.timestampMs,
    timestampMs: entry.timestampMs,
    completed: false,
    success: null,
    error: null,
    cached: false,
    executionTimeMs: null,
    userExecutionTimeMs: null,
    usage: null,
    returnBytes: null,
    environment: null,
    lines: [],
    linesDropped: 0,
  };
}

function withTimestamps(entry: ConvexLogEntry) {
  return entry.lines.map((line) => ({
    ...line,
    timestampMs: line.timestampMs ?? entry.timestampMs,
  }));
}

export function mergeLogEntries(
  previous: ConvexExecution[],
  entries: ConvexLogEntry[],
  limit = LOG_BUFFER_LIMIT,
): ConvexExecution[] {
  if (entries.length === 0) return previous;
  const next = previous.slice();
  const index = new Map(next.map((execution, position) => [execution.key, position]));
  entries.forEach((entry, position) => {
    const key = entry.executionId || `${entry.requestId}:${entry.timestampMs}:${position}`;
    const at = index.get(key);
    const current = at === undefined ? fromEntry(key, entry) : next[at];
    const lines = withTimestamps(entry);
    let merged: ConvexExecution;
    if (entry.kind === "progress") {
      merged = {
        ...current,
        ...boundLines([...current.lines, ...lines], current.linesDropped + entry.linesDropped),
      };
    } else {
      const replace = lines.length >= current.lines.length && lines.length > 0;
      merged = {
        ...current,
        identifier: entry.identifier || current.identifier,
        udfType: entry.udfType || current.udfType,
        componentPath: entry.componentPath,
        caller: entry.caller,
        parentExecutionId: entry.parentExecutionId,
        timestampMs: entry.timestampMs,
        completed: true,
        success: entry.success,
        error: entry.error,
        cached: entry.cached,
        executionTimeMs: entry.executionTimeMs,
        userExecutionTimeMs: entry.userExecutionTimeMs,
        usage: entry.usage,
        returnBytes: entry.returnBytes,
        environment: entry.environment,
        ...(replace
          ? boundLines(lines, entry.linesDropped)
          : boundLines([...current.lines, ...lines], current.linesDropped + entry.linesDropped)),
      };
    }
    if (at === undefined) {
      index.set(key, next.length);
      next.push(merged);
    } else {
      next[at] = merged;
    }
  });
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function visibleLines(execution: ConvexExecution, levels: LogLevel[]) {
  if (levels.length === LOG_LEVELS.length) return execution.lines;
  return execution.lines.filter((line) => levels.includes(line.level as LogLevel));
}

export function filterExecutions(executions: ConvexExecution[], filters: LogFilters) {
  const search = filters.search.trim().toLowerCase();
  const allLevels = filters.levels.length === LOG_LEVELS.length;
  return executions.filter((execution) => {
    if (filters.identifier !== "all" && execution.identifier !== filters.identifier) return false;
    if (filters.status === "success" && execution.success !== true) return false;
    if (filters.status === "failure" && execution.success !== false) return false;
    if (filters.status === "running" && execution.completed) return false;
    const lines = visibleLines(execution, filters.levels);
    if (!allLevels && lines.length === 0 && !(execution.error && filters.levels.includes("ERROR")))
      return false;
    if (!search) return true;
    return (
      execution.identifier.toLowerCase().includes(search) ||
      execution.requestId.toLowerCase().includes(search) ||
      execution.executionId.toLowerCase().includes(search) ||
      (execution.error?.toLowerCase().includes(search) ?? false) ||
      lines.some((line) => line.message.toLowerCase().includes(search))
    );
  });
}

export type LogRow =
  | { type: "group"; requestId: string; executions: ConvexExecution[] }
  | { type: "execution"; execution: ConvexExecution; nested: boolean };

export function buildLogRows(executions: ConvexExecution[], grouped: boolean): LogRow[] {
  const ordered = executions.slice().reverse();
  if (!grouped)
    return ordered.map((execution) => ({ type: "execution", execution, nested: false }));
  const groups = new Map<string, ConvexExecution[]>();
  for (const execution of ordered) {
    const key = execution.requestId || execution.key;
    const members = groups.get(key);
    if (members) members.push(execution);
    else groups.set(key, [execution]);
  }
  const rows: LogRow[] = [];
  for (const [requestId, members] of groups) {
    rows.push({ type: "group", requestId, executions: members });
    for (const execution of members.slice().reverse())
      rows.push({ type: "execution", execution, nested: true });
  }
  return rows;
}

export interface LogBucket {
  at: number;
  requests: number;
  errors: number;
}

export function bucketExecutions(executions: ConvexExecution[], maxBuckets = 120) {
  const completed = executions.filter((execution) => execution.completed);
  if (completed.length === 0) return { size: 60_000, buckets: [] as LogBucket[] };
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const execution of completed) {
    first = Math.min(first, execution.timestampMs);
    last = Math.max(last, execution.timestampMs);
  }
  const minutes = Math.max(1, Math.ceil((last - first + 1) / 60_000));
  const size = 60_000 * Math.ceil(minutes / maxBuckets);
  const start = Math.floor(first / size) * size;
  const count = Math.floor((last - start) / size) + 1;
  const buckets = Array.from({ length: count }, (_, position) => ({
    at: start + position * size,
    requests: 0,
    errors: 0,
  }));
  for (const execution of completed) {
    const bucket = buckets[Math.floor((execution.timestampMs - start) / size)];
    bucket.requests += 1;
    if (execution.success === false) bucket.errors += 1;
  }
  return { size, buckets };
}

export function toJsonl(executions: ConvexExecution[], levels: LogLevel[]) {
  return executions
    .map((execution) => JSON.stringify({ ...execution, lines: visibleLines(execution, levels) }))
    .join("\n");
}

export function executionStatus(execution: ConvexExecution) {
  if (!execution.completed) return "läuft";
  return execution.success ? "erfolgreich" : "fehlgeschlagen";
}

export function formatLogTime(ms: number) {
  return new Date(ms).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function formatDuration(ms: number | null) {
  if (ms === null) return "–";
  return ms < 1000 ? `${ms.toFixed(ms < 10 ? 2 : 0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export const LEVEL_CLASS: Record<string, string> = {
  DEBUG: "text-muted-foreground",
  LOG: "text-foreground",
  INFO: "text-sky-600 dark:text-sky-400",
  WARN: "text-amber-600 dark:text-amber-400",
  ERROR: "text-destructive",
};
