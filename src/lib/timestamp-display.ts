import { parseDbTimestamp } from "@/lib/grid-cell-format";

export type TimestampOptions = {
  mode: "raw" | "utc" | "local";
  precision: "seconds" | "milliseconds";
};

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const pad = (n: number, size = 2) => String(n).padStart(size, "0");

export function timestampCellText(value: unknown, options: TimestampOptions): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const match = value.match(TIMESTAMP);
  if (!match) return null;
  if (options.mode === "raw" || !match[1]) return value;
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
