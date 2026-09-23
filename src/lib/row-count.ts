import type { RowCount } from "@/lib/db";

const full = new Intl.NumberFormat("de-DE");
const compact = new Intl.NumberFormat("de-DE", { notation: "compact" });

export function exactRowCount(count: RowCount | undefined): number | undefined {
  return count?.exact ? count.count : undefined;
}

export function approximateRowCount(count: RowCount | undefined): string | undefined {
  if (!count || count.exact) return undefined;
  if (count.estimate !== null) return `≈ ${compact.format(count.estimate)}`;
  return `über ${full.format(count.count - 1)}`;
}

export function shortRowCount(count: RowCount): string {
  if (count.exact) return compact.format(count.count);
  if (count.estimate !== null) return `≈ ${compact.format(count.estimate)}`;
  return `${compact.format(count.count - 1)}+`;
}
