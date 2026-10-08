import type { UsageStatistics } from "@/lib/usage-statistics";

export const USAGE_AREA_LIMIT = 8;
export const USAGE_PATH_LIMIT = 8;
export const USAGE_OPERATION_LIMIT = 16;

const numberFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatUsageCount(value: number): string {
  return numberFormat.format(value);
}

export function formatUsageActivity(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1000);
  if (seconds < 60) return `${seconds} Sek.`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} Min.`;
  return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
}

export function formatUsageLatency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "–";
  if (value > 300000) return "> 5 Min.";
  if (value < 1000) return `${numberFormat.format(value)} ms`;
  return `${numberFormat.format(value / 1000)} s`;
}

export function formatUsageDate(value: number | null): string {
  return value === null ? "–" : dateFormat.format(value);
}

export function summarizeUsageStatistics(statistics: UsageStatistics) {
  let activeMs = 0;
  let viewOpens = 0;
  let operationCount = 0;
  let successful = 0;
  let errors = 0;
  let cancelled = 0;
  for (const view of statistics.views) {
    activeMs += view.activeMs;
    viewOpens += view.opens;
  }
  for (const operation of statistics.operations) {
    successful += operation.ok;
    errors += operation.error;
    cancelled += operation.cancelled;
    operationCount += operation.ok + operation.error + operation.cancelled;
  }
  return {
    activeMs,
    viewOpens,
    operationCount,
    successful,
    errors,
    cancelled,
    hasActivity: statistics.views.length > 0 || operationCount > 0 || statistics.startup.count > 0,
    areas: [...statistics.views]
      .sort((left, right) => right.opens - left.opens || right.activeMs - left.activeMs)
      .slice(0, USAGE_AREA_LIMIT),
    paths: [...statistics.transitions]
      .sort((left, right) => right.count - left.count)
      .slice(0, USAGE_PATH_LIMIT),
    operations: [...statistics.operations]
      .sort(
        (left, right) =>
          right.ok + right.error + right.cancelled - (left.ok + left.error + left.cancelled),
      )
      .slice(0, USAGE_OPERATION_LIMIT),
  };
}

export type UsageStatisticsSummary = ReturnType<typeof summarizeUsageStatistics>;
