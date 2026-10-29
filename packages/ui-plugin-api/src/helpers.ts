const DAY = 86_400_000;

export function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function asDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : typeof value === "string"
          ? new Date(
              /^\d{4}-\d{2}-\d{2}$/.test(value)
                ? `${value}T00:00`
                : /^\d{4}-\d{2}-\d{2} \d/.test(value)
                  ? value.replace(" ", "T")
                  : value,
            )
          : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function daysFromToday(value: unknown): number | null {
  const date = asDate(value);
  if (!date) return null;
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((target - start) / DAY);
}

const numberFormats = new Map<string, Intl.NumberFormat>();

export function formatNumber(
  value: unknown,
  options: { decimals?: number; currency?: string } = {},
): string {
  const number = asNumber(value);
  if (number === null) return asText(value);
  const decimals =
    options.decimals === undefined
      ? undefined
      : Math.max(0, Math.min(10, Math.trunc(options.decimals)));
  const currency =
    typeof options.currency === "string" && /^[A-Z]{3}$/.test(options.currency)
      ? options.currency
      : undefined;
  const key = `${decimals ?? ""}:${currency ?? ""}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("de-DE", {
      ...(currency ? { style: "currency", currency } : {}),
      ...(decimals === undefined
        ? {}
        : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    });
    numberFormats.set(key, format);
  }
  return format.format(number);
}

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(value: unknown, options: { time?: boolean } = {}): string {
  const date = asDate(value);
  if (!date) return asText(value);
  return (options.time ? dateTimeFormat : dateFormat).format(date);
}

const relative = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTime(date: Date, now = Date.now()): string {
  const diff = date.getTime() - now;
  for (const [unit, size] of UNITS)
    if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
  return relative.format(0, "minute");
}

export function definePlugin<P>(plugin: P): P {
  return plugin;
}
