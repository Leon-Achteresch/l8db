import type { QueryHistoryEntry } from "@/lib/query-history";

export const ACTIVITY_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVITY_POINT_LIMIT = 400;
export const RECENT_LIMIT = 20;

const msFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const weekdayFormatter = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

export interface ActivityPoint {
  id: string;
  x: number;
  y: number;
  error: boolean;
  label: string;
}

export interface Activity {
  recent: QueryHistoryEntry[];
  points: ActivityPoint[];
  days: { x: number; label: string }[];
}

export function selectActivity(
  history: QueryHistoryEntry[],
  connectionId: string,
  database: string | null,
  now: number,
): Activity {
  const cutoff = now - ACTIVITY_RANGE_MS;
  const recent: QueryHistoryEntry[] = [];
  const timed: QueryHistoryEntry[] = [];
  for (const entry of history) {
    if (entry.connectionId !== connectionId || entry.database !== database) continue;
    const inRange = entry.ranAt >= cutoff && entry.ranAt <= now;
    if (recent.length < RECENT_LIMIT) recent.push(entry);
    if (inRange && timed.length < ACTIVITY_POINT_LIMIT) timed.push(entry);
    if (
      recent.length === RECENT_LIMIT &&
      (entry.ranAt < cutoff || timed.length === ACTIVITY_POINT_LIMIT)
    )
      break;
  }
  const slowest = Math.max(1, ...timed.map((entry) => entry.durationMs ?? 0));
  const scale = Math.log1p(slowest);
  const points = timed.map((entry) => ({
    id: entry.id,
    x: 1 - (now - entry.ranAt) / ACTIVITY_RANGE_MS,
    y: Math.log1p(Math.max(0, entry.durationMs ?? 0)) / scale,
    error: Boolean(entry.error),
    label: `${entry.durationMs == null || !Number.isFinite(entry.durationMs) ? "—" : `${msFormatter.format(entry.durationMs)} ms`} · ${entry.sql.slice(0, 120)}`,
  }));
  const days: Activity["days"] = [];
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  while (date.getTime() > cutoff) {
    days.push({
      x: 1 - (now - date.getTime()) / ACTIVITY_RANGE_MS,
      label: weekdayFormatter.format(date),
    });
    date.setDate(date.getDate() - 1);
  }
  return { recent, points, days };
}
