export type GridColumnKind = "text" | "number" | "boolean" | "date" | "json" | "key" | "uuid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const DAY = 86_400_000;
const CATEGORY_LIMIT = 8;
const CATEGORY_MAX_LENGTH = 24;
const CATEGORY_TOKEN = /^(?:[a-z0-9]+(?:[ _.-][a-z0-9]+)*|[A-Z0-9]+(?:[ _.-][A-Z0-9]+)*)$/;
const PLAIN_TYPES =
  /char|text|string|clob|name|citext|xml|json|bytea|blob|binary|inet|cidr|macaddr|tsvector|tsquery|point|line|polygon|geometry|geography|interval|bit|money|ltree|hstore|vector/i;

export const CATEGORY_COLORS = 6;

export function shortUuid(value: string): string {
  return UUID.test(value) ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function splitEmail(value: string): [string, string] | null {
  if (!EMAIL.test(value)) return null;
  const at = value.lastIndexOf("@");
  return [value.slice(0, at), value.slice(at)];
}

export function parseDbTimestamp(raw: string): Date | null {
  const match = raw.trim().match(TIMESTAMP);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const time = hour
    ? `${hour}:${minute}:${second ?? "00"}${(fraction ?? "").slice(0, 4)}`
    : "00:00:00";
  const offset = !zone
    ? ""
    : zone.toUpperCase() === "Z"
      ? "Z"
      : zone.length === 3
        ? `${zone}:00`
        : zone.includes(":")
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const date = new Date(`${year}-${month}-${day}T${time}${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const relativeFormat = new Intl.RelativeTimeFormat("de", { numeric: "auto" });

function relativeLabel(date: Date, now: Date): string | null {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs >= 30 * DAY) return null;
  if (abs < 60_000) return relativeFormat.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return relativeFormat.format(Math.round(diff / 60_000), "minute");
  if (abs < DAY) return relativeFormat.format(Math.round(diff / 3_600_000), "hour");
  return relativeFormat.format(Math.round(diff / DAY), "day");
}

export type TimestampDisplay = { primary: string; secondary: string };

export function timestampDisplay(raw: string, now = new Date()): TimestampDisplay | null {
  const match = raw.trim().match(TIMESTAMP);
  const date = match ? parseDbTimestamp(raw) : null;
  if (!match || !date) return null;
  const [, year, month, day, hour, minute] = match;
  const time = hour ? `${hour}:${minute}` : "";
  if (!hour) return { primary: `${day}.${month}.${year}`, secondary: "" };
  return { primary: relativeLabel(date, now) ?? `${day}.${month}.${year}`, secondary: time };
}

export function categoryColorIndex(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % CATEGORY_COLORS;
}

export function isEnumDataType(dataType: string | undefined): boolean {
  return !!dataType && !PLAIN_TYPES.test(dataType);
}

export function isCategorical(values: readonly unknown[], enumType = false): boolean {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (present.length < 4) return false;
  const distinct = new Set<string>();
  for (const value of present) {
    if (typeof value !== "string") return false;
    if (value.length === 0 || value.length > CATEGORY_MAX_LENGTH || value.includes("\n"))
      return false;
    if (!enumType && !CATEGORY_TOKEN.test(value)) return false;
    distinct.add(value);
    if (distinct.size > CATEGORY_LIMIT) return false;
  }
  return distinct.size <= Math.ceil(present.length / 2);
}

export function jsonEntries(value: unknown, limit = 3): [string, string][] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries: [string, string][] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entries.length === limit) break;
    entries.push([
      key,
      entry !== null && typeof entry === "object"
        ? Array.isArray(entry)
          ? `[${entry.length}]`
          : "{…}"
        : String(entry),
    ]);
  }
  return entries.length ? entries : null;
}
