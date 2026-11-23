import type { DatabaseKind } from "@/lib/db";
import { parseDbTimestamp } from "@/lib/grid-cell-format";

export type TimestampOptions = {
  mode: "raw" | "utc" | "local" | "business";
  precision: "seconds" | "milliseconds";
  timeZone?: string;
};

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const POSTGRES_INSTANT =
  /^(\d{4}-\d{2}-\d{2})[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})? ?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const ZONE_NAME = /^[a-z][a-z0-9_.+-]*(?:\/[a-z0-9_.+-]+)*$/i;
const MAX_ZONE_FORMATTERS = 8;
const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();
const pad = (n: number, size = 2) => String(n).padStart(size, "0");

function zoneFormatter(zone: string) {
  if (zone.length > 96 || !ZONE_NAME.test(zone)) return null;
  const cached = zoneFormatters.get(zone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      calendar: "iso8601",
      numberingSystem: "latn",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    });
  } catch {
    formatter = null;
  }
  if (zoneFormatters.size >= MAX_ZONE_FORMATTERS) {
    const oldest = zoneFormatters.keys().next().value;
    if (oldest !== undefined) zoneFormatters.delete(oldest);
  }
  zoneFormatters.set(zone, formatter);
  return formatter;
}

export function normalizeBusinessTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 96) return undefined;
  return zoneFormatter(value.trim())?.resolvedOptions().timeZone;
}

export function normalizeTimestampOptions(
  value?: Partial<TimestampOptions> | null,
): TimestampOptions {
  const timeZone = normalizeBusinessTimeZone(value?.timeZone);
  const mode =
    value?.mode === "utc" || value?.mode === "local" || (value?.mode === "business" && timeZone)
      ? value.mode
      : "raw";
  return {
    mode,
    precision: value?.precision === "milliseconds" ? "milliseconds" : "seconds",
    ...(timeZone ? { timeZone } : {}),
  };
}

export function supportsBusinessTimestamp(kind?: DatabaseKind, dataType?: string): boolean {
  return (
    kind === "postgres" &&
    /^(?:timestamptz(?:\([0-6]\))?|timestamp(?:\([0-6]\))? with time zone)$/i.test(
      dataType?.trim() ?? "",
    )
  );
}

function businessTimestamp(value: string, zone: string): string {
  const match = POSTGRES_INSTANT.exec(value);
  const formatter = match && zoneFormatter(zone);
  if (!match || !formatter) return value;
  const [, day, fraction] = match;
  const calendarDay = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendarDay.getTime()) || !calendarDay.toISOString().startsWith(day))
    return value;
  const date = parseDbTimestamp(value);
  if (!date) return value;
  const fields: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) fields[part.type] = part.value;
  if (fields.era !== "AD" || !fields.year || fields.year.length > 4 || !fields.timeZoneName)
    return value;
  const offset = fields.timeZoneName === "GMT" ? "+00:00" : fields.timeZoneName.slice(3);
  if (!/^[+-]\d{2}:\d{2}(?::\d{2})?$/.test(offset)) return value;
  return `${fields.year.padStart(4, "0")}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}${fraction ?? ""} ${offset}`;
}

export function timestampCellText(
  value: unknown,
  options: TimestampOptions,
  kind?: DatabaseKind,
  dataType?: string,
): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const match = value.match(TIMESTAMP);
  if (!match) return null;
  if (options.mode === "raw" || !match[1]) return value;
  if (options.mode === "business") {
    return options.timeZone && supportsBusinessTimestamp(kind, dataType)
      ? businessTimestamp(value, options.timeZone)
      : value;
  }
  const date = parseDbTimestamp(value);
  if (!date) return value;
  if (options.mode === "utc") {
    const iso = date.toISOString();
    return `${iso.slice(0, options.precision === "milliseconds" ? 23 : 19).replace("T", " ")} UTC`;
  }
  const offset = -date.getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  const fraction = options.precision === "milliseconds" ? `.${pad(date.getMilliseconds(), 3)}` : "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${fraction} ${zone}`;
}
