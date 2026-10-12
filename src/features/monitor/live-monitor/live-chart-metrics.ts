import type { LivePoint } from "@/lib/live-monitor";

export type LiveChartMetric =
  | "queries"
  | "transactions"
  | "rows"
  | "blocks"
  | "cpu"
  | "connections";

export interface LiveChartRow {
  at: number;
  a: number;
  b: number;
  c: number;
}

interface MetricDefinition {
  label: string;
  series: { key: "a" | "b" | "c"; label: string; color: string }[];
  pick: (point: LivePoint) => [number, number, number];
}

const BLUE = "oklch(0.56 0.14 262)";
const GREEN = "oklch(0.64 0.15 150)";
const GRAY = "oklch(0.7 0.01 260)";
const RED = "oklch(0.62 0.18 25)";

export const LIVE_CHART_METRICS: Record<LiveChartMetric, MetricDefinition> = {
  queries: {
    label: "Anfragen / Sekunde",
    series: [
      { key: "a", label: "Select", color: BLUE },
      { key: "b", label: "Ändern", color: GREEN },
      { key: "c", label: "Andere", color: GRAY },
    ],
    pick: (point) => [point.queriesRead ?? 0, point.queriesWrite ?? 0, point.queriesOther ?? 0],
  },
  transactions: {
    label: "Transaktionen / Sekunde",
    series: [
      { key: "a", label: "Commit", color: BLUE },
      { key: "b", label: "Rollback", color: RED },
    ],
    pick: (point) => [point.commits, point.rollbacks, 0],
  },
  rows: {
    label: "Zeilen / Sekunde",
    series: [
      { key: "a", label: "Gelesen", color: BLUE },
      { key: "b", label: "Geschrieben", color: GREEN },
    ],
    pick: (point) => [point.rowsRead, point.rowsWritten, 0],
  },
  blocks: {
    label: "Blöcke / Sekunde",
    series: [
      { key: "a", label: "Cache-Treffer", color: BLUE },
      { key: "b", label: "Disk-Lesen", color: GREEN },
    ],
    pick: (point) => [point.blocksHit, point.blocksRead, 0],
  },
  cpu: {
    label: "CPU Auslastung (%)",
    series: [{ key: "a", label: "CPU", color: BLUE }],
    pick: (point) => [point.cpu ?? 0, 0, 0],
  },
  connections: {
    label: "Verbindungen",
    series: [
      { key: "a", label: "Verbunden", color: BLUE },
      { key: "b", label: "Aktiv", color: GREEN },
      { key: "c", label: "Wartende Locks", color: RED },
    ],
    pick: (point) => [point.connections, point.activeSessions, point.waitingLocks],
  },
};

export const ACTIVITY_METRICS: LiveChartMetric[] = ["queries", "transactions", "rows", "blocks"];

export function liveChartRows(
  points: LivePoint[],
  metric: LiveChartMetric,
  maxRows = 240,
): LiveChartRow[] {
  const pick = LIVE_CHART_METRICS[metric].pick;
  const bucket = Math.max(1, Math.ceil(points.length / maxRows));
  const rows: LiveChartRow[] = [];
  for (let start = 0; start < points.length; start += bucket) {
    const end = Math.min(points.length, start + bucket);
    let a = 0;
    let b = 0;
    let c = 0;
    for (let index = start; index < end; index++) {
      const [x, y, z] = pick(points[index]);
      a += x;
      b += y;
      c += z;
    }
    const size = end - start;
    rows.push({ at: points[end - 1].at, a: a / size, b: b / size, c: c / size });
  }
  return rows;
}
