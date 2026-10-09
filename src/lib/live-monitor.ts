import { create } from "zustand";
import type { LiveMetrics } from "@/lib/db";

export const LIVE_POINT_LIMIT = 1800;
export const LIVE_DETAIL_INTERVAL_MS = 30_000;
export const LIVE_INTERVALS = [2000, 5000, 10_000, 30_000] as const;
export const LIVE_RANGES = [5, 15, 30, 60] as const;

export type LiveInterval = (typeof LIVE_INTERVALS)[number];
export type LiveRange = (typeof LIVE_RANGES)[number];

export interface LiveSnapshot {
  at: number;
  metrics: LiveMetrics;
}

export interface LivePoint {
  at: number;
  tps: number;
  commits: number;
  rollbacks: number;
  queriesRead: number | null;
  queriesWrite: number | null;
  queriesOther: number | null;
  rowsRead: number;
  rowsWritten: number;
  blocksRead: number;
  blocksHit: number;
  tempBytes: number | null;
  cpu: number | null;
  sizeBytes: number | null;
  connections: number;
  activeSessions: number;
  waitingLocks: number;
}

export interface LiveSeriesState {
  key: string | null;
  last: LiveSnapshot | null;
  points: LivePoint[];
  sizeBytes: number | null;
  tableIo: LiveMetrics["table_io"];
  detailsAt: number;
}

export const EMPTY_LIVE_SERIES: LiveSeriesState = {
  key: null,
  last: null,
  points: [],
  sizeBytes: null,
  tableIo: [],
  detailsAt: 0,
};

function perSecond(current: number, previous: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(0, current - previous) / seconds;
}

function optionalPerSecond(
  current: number | null,
  previous: number | null,
  seconds: number,
): number | null {
  if (current == null || previous == null) return null;
  return perSecond(current, previous, seconds);
}

export function cpuPercent(previous: LiveMetrics, current: LiveMetrics): number | null {
  if (
    current.cpu_busy == null ||
    current.cpu_total == null ||
    previous.cpu_busy == null ||
    previous.cpu_total == null
  )
    return null;
  const total = current.cpu_total - previous.cpu_total;
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, ((current.cpu_busy - previous.cpu_busy) / total) * 100));
}

export function toLivePoint(
  previous: LiveSnapshot,
  next: LiveSnapshot,
  sizeBytes: number | null,
): LivePoint {
  const seconds = (next.at - previous.at) / 1000;
  const a = previous.metrics;
  const b = next.metrics;
  const commits = perSecond(b.commits, a.commits, seconds);
  const rollbacks = perSecond(b.rollbacks, a.rollbacks, seconds);
  return {
    at: next.at,
    tps: commits + rollbacks,
    commits,
    rollbacks,
    queriesRead: optionalPerSecond(b.queries_read, a.queries_read, seconds),
    queriesWrite: optionalPerSecond(b.queries_write, a.queries_write, seconds),
    queriesOther: optionalPerSecond(b.queries_other, a.queries_other, seconds),
    rowsRead: perSecond(b.rows_read, a.rows_read, seconds),
    rowsWritten: perSecond(b.rows_written, a.rows_written, seconds),
    blocksRead: perSecond(b.blocks_read, a.blocks_read, seconds),
    blocksHit: perSecond(b.blocks_hit, a.blocks_hit, seconds),
    tempBytes: optionalPerSecond(b.temp_bytes, a.temp_bytes, seconds),
    cpu: cpuPercent(a, b),
    sizeBytes,
    connections: b.connections,
    activeSessions: b.active_sessions,
    waitingLocks: b.waiting_locks,
  };
}

export function appendPoint(
  points: LivePoint[],
  point: LivePoint,
  limit = LIVE_POINT_LIMIT,
): LivePoint[] {
  if (points.length < limit) return [...points, point];
  const next = points.slice(points.length - limit + 1);
  next.push(point);
  return next;
}

export function reduceLiveSample(
  state: LiveSeriesState,
  key: string,
  snapshot: LiveSnapshot,
  includedDetails: boolean,
  limit = LIVE_POINT_LIMIT,
): LiveSeriesState {
  const base = state.key === key ? state : { ...EMPTY_LIVE_SERIES, key };
  const sizeBytes =
    includedDetails && snapshot.metrics.database_size_bytes != null
      ? snapshot.metrics.database_size_bytes
      : base.sizeBytes;
  const previous = base.last;
  const usable = previous && snapshot.at > previous.at;
  return {
    key,
    last: snapshot,
    sizeBytes,
    tableIo: includedDetails ? snapshot.metrics.table_io : base.tableIo,
    detailsAt: includedDetails ? snapshot.at : base.detailsAt,
    points: usable
      ? appendPoint(base.points, toLivePoint(previous, snapshot, sizeBytes), limit)
      : base.points,
  };
}

export function firstIndexAtOrAfter(points: LivePoint[], at: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].at < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function pointsInRange(points: LivePoint[], now: number, minutes: number): LivePoint[] {
  const start = firstIndexAtOrAfter(points, now - minutes * 60_000);
  return start === 0 ? points : points.slice(start);
}

export function averageOf(points: LivePoint[], pick: (point: LivePoint) => number | null) {
  let sum = 0;
  let count = 0;
  for (const point of points) {
    const value = pick(point);
    if (value == null) continue;
    sum += value;
    count++;
  }
  return count ? sum / count : null;
}

export function percentChange(current: number | null, base: number | null): number | null {
  if (current == null || base == null || base === 0) return null;
  return ((current - base) / base) * 100;
}

export function needsDetails(state: LiveSeriesState, key: string, now: number): boolean {
  return state.key !== key || now - state.detailsAt >= LIVE_DETAIL_INTERVAL_MS;
}

export function liveKey(connectionId: string, database: string | null): string {
  return `${connectionId}\u0000${database ?? ""}`;
}

export interface LivePollingOptions {
  intervalMs: number;
  isHidden: () => boolean;
  poll: () => Promise<void>;
  schedule?: (callback: () => void, ms: number) => number;
  clear?: (handle: number) => void;
}

export function startLivePolling({
  intervalMs,
  isHidden,
  poll,
  schedule = (callback, ms) => window.setTimeout(callback, ms),
  clear = (handle) => window.clearTimeout(handle),
}: LivePollingOptions): () => void {
  let cancelled = false;
  let handle: number | undefined;
  const tick = async () => {
    if (cancelled) return;
    if (!isHidden()) {
      await poll().catch(() => undefined);
    }
    if (!cancelled) handle = schedule(() => void tick(), intervalMs);
  };
  void tick();
  return () => {
    cancelled = true;
    if (handle !== undefined) clear(handle);
  };
}

interface LiveMonitorStore extends LiveSeriesState {
  push: (key: string, snapshot: LiveSnapshot, includedDetails: boolean) => void;
}

export const useLiveMonitorStore = create<LiveMonitorStore>((set) => ({
  ...EMPTY_LIVE_SERIES,
  push: (key, snapshot, includedDetails) =>
    set((state) => reduceLiveSample(state, key, snapshot, includedDetails)),
}));
