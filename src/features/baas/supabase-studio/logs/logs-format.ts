export interface LogsTabProps {
  reference: string;
  refetchInterval: number | false;
}

export function logsQueryKey(reference: string, ...rest: (string | number | boolean)[]) {
  return ["supabase", reference, "studio-observability", ...rest] as const;
}

export function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  if (value < 1000) return `${value.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ms`;
  if (value < 60_000)
    return `${(value / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`;
  if (value < 3_600_000)
    return `${Math.floor(value / 60_000)} min ${Math.round((value % 60_000) / 1000)} s`;
  return `${Math.floor(value / 3_600_000)} h ${Math.round((value % 3_600_000) / 60_000)} min`;
}

export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return `${(value * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %`;
}

export function formatNumber(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString("de-DE") : "–";
}

export function formatLogTimestamp(value: number | string): string {
  const date = typeof value === "number" ? new Date(value / 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("de-DE") : String(value);
}

export function logTone(message: string | null): "error" | "warning" | null {
  if (!message) return null;
  const head = message.slice(0, 200);
  if (
    /\b(ERROR|FATAL|PANIC)\b/.test(head) ||
    /"level"\s*:\s*"(error|fatal)"|\bstatus[=: ]+5\d\d\b/i.test(head)
  )
    return "error";
  if (/\bWARN(ING)?\b/.test(head) || /"level"\s*:\s*"warn(ing)?"|\bstatus[=: ]+4\d\d\b/i.test(head))
    return "warning";
  return null;
}
