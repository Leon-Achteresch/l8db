import { formatBytes } from "@/features/monitor/monitor-view/format";
import type { AtlasTable } from "./atlas-layout";

const compact = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("de-DE");

export function formatRows(rows: number): string {
  return `${rows < 10_000 ? plain.format(rows) : compact.format(rows)} ${rows === 1 ? "Zeile" : "Zeilen"}`;
}

export function atlasFacts(
  table: Pick<AtlasTable, "rows" | "bytes">,
  metric: "bytes" | "rows" | null,
): [string | null, string | null] {
  const rows = table.rows != null ? `≈ ${formatRows(table.rows)}` : null;
  const bytes = table.bytes != null ? formatBytes(table.bytes) : null;
  return metric === "rows" ? [rows, bytes] : [bytes, rows];
}

export function describeAtlasTable(table: Pick<AtlasTable, "rows" | "bytes">): string {
  const parts: string[] = [];
  if (table.rows != null) parts.push(`≈ ${formatRows(table.rows)}`);
  if (table.bytes != null) parts.push(formatBytes(table.bytes));
  return parts.join(" · ");
}

const relative = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto", style: "short" });

export function formatAgo(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}
