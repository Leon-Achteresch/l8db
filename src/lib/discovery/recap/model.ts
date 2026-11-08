import type { FeatureEntry } from "@/lib/discovery/types";
import type { FeatureUsage } from "@/lib/discovery/usage";
import { DURATION_BUCKETS, type UsageStatistics } from "@/lib/usage-statistics";

export const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
export const WEEKDAYS = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];
const QUERY_OPERATIONS = new Set(["query", "user-query"]);
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface RecapInput {
  year: number;
  statistics: UsageStatistics;
  usage: FeatureUsage;
  days: Record<string, number>;
  longestMs: number;
  catalog: readonly FeatureEntry[];
}

export interface Recap {
  year: number;
  queries: number;
  operations: number;
  families: { kind: string; count: number }[];
  longestMs: number;
  activeMonth: string | null;
  activeWeekday: string | null;
  activeDays: number;
  topFeatures: { id: string; title: string; count: number }[];
  neverTried: FeatureEntry[];
  empty: boolean;
}

export function recapYear(now = new Date()): number | null {
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 11) return now.getFullYear();
  if (month === 0 && day <= 15) return now.getFullYear() - 1;
  return null;
}

export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function top<T>(map: Map<T, number>): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const [key, count] of map)
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  return best;
}

function histogramMax(statistics: UsageStatistics): number {
  let index = -1;
  for (const row of statistics.operations)
    for (let bucket = row.histogram.length - 1; bucket > index; bucket--)
      if (row.histogram[bucket] > 0) {
        index = bucket;
        break;
      }
  return index < 0 ? 0 : (DURATION_BUCKETS[index] ?? 86_400_000);
}

export function computeRecap(input: RecapInput): Recap {
  let queries = 0;
  let operations = 0;
  const families = new Map<string, number>();
  for (const row of input.statistics.operations) {
    const total = row.ok + row.error + row.cancelled;
    operations += total;
    if (QUERY_OPERATIONS.has(row.operation)) queries += total;
    if (row.kind !== "unknown") families.set(row.kind, (families.get(row.kind) ?? 0) + total);
  }
  const months = new Map<number, number>();
  const weekdays = new Map<number, number>();
  let activeDays = 0;
  for (const [key, count] of Object.entries(input.days)) {
    const match = DAY_KEY.exec(key);
    if (!match || Number(match[1]) !== input.year || !(count > 0)) continue;
    activeDays++;
    const month = Number(match[2]) - 1;
    const weekday = new Date(input.year, month, Number(match[3])).getDay();
    months.set(month, (months.get(month) ?? 0) + count);
    weekdays.set(weekday, (weekdays.get(weekday) ?? 0) + count);
  }
  const titles = new Map(input.catalog.map((entry) => [entry.id, entry.title]));
  const yearStart = new Date(input.year, 0, 1).getTime();
  const yearEnd = new Date(input.year + 1, 0, 1).getTime();
  const topFeatures: Recap["topFeatures"] = [];
  for (const [id, entry] of Object.entries(input.usage)) {
    const title = titles.get(id);
    if (!title || entry.last < yearStart || entry.first >= yearEnd) continue;
    topFeatures.push({ id, title, count: entry.count });
  }
  topFeatures.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  const neverTried = input.catalog
    .filter((entry) => input.usage[entry.id] === undefined)
    .sort((a, b) => Number(b.size === "major") - Number(a.size === "major"))
    .slice(0, 3);
  const month = top(months);
  const weekday = top(weekdays);
  const longestMs = Math.max(0, input.longestMs) || histogramMax(input.statistics);
  return {
    year: input.year,
    queries,
    operations,
    families: [...families]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
    longestMs,
    activeMonth: month === null ? null : MONTHS[month],
    activeWeekday: weekday === null ? null : WEEKDAYS[weekday],
    activeDays,
    topFeatures: topFeatures.slice(0, 5),
    neverTried,
    empty: operations === 0 && activeDays === 0 && topFeatures.length === 0,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1).replace(".", ",")} h`;
}
