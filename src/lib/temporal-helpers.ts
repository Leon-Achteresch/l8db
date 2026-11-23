export type TemporalKind = "date" | "datetime" | "datetimetz" | "time" | "timetz";

export type TemporalHelper = {
  id: string;
  label: string;
  value: (now: Date) => string;
};

type Moment = "now" | "today" | "yesterday" | "tomorrow" | "monthStart";

export function temporalKind(
  dataType: string | null | undefined,
  databaseKind?: string | null,
): TemporalKind | null {
  if (!dataType) return null;
  const lower = dataType.toLowerCase().replace(/\s+/g, " ").trim();
  if (lower.includes("interval") || lower.endsWith("[]") || lower.startsWith("array(")) return null;
  const tz = /with time zone|timestamptz|timetz|datetimeoffset/.test(lower);
  if (/timestamp|datetime/.test(lower)) return tz ? "datetimetz" : "datetime";
  if (/^(?:nullable\()?time\b|^timetz\b/.test(lower)) return tz ? "timetz" : "time";
  if (/^(?:nullable\()?date(?:32)?\b/.test(lower))
    return databaseKind === "oracle" ? "datetime" : "date";
  return null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function offset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatTemporal(date: Date, kind: TemporalKind): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  switch (kind) {
    case "date":
      return day;
    case "datetime":
      return `${day} ${time}`;
    case "datetimetz":
      return `${day} ${time}.${pad(date.getMilliseconds(), 3)} ${offset(date)}`;
    case "time":
      return time;
    case "timetz":
      return `${time}${offset(date)}`;
  }
}

function momentDate(moment: Moment, now: Date): Date {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (moment) {
    case "now":
      return now;
    case "today":
      return new Date(y, m, d);
    case "yesterday":
      return new Date(y, m, d - 1);
    case "tomorrow":
      return new Date(y, m, d + 1);
    case "monthStart":
      return new Date(y, m, 1);
  }
}

const HELPERS: { id: Moment; label: string; times: boolean }[] = [
  { id: "now", label: "Jetzt", times: true },
  { id: "today", label: "Heute", times: false },
  { id: "yesterday", label: "Gestern", times: false },
  { id: "tomorrow", label: "Morgen", times: false },
  { id: "monthStart", label: "Monatsanfang", times: false },
];

export function temporalHelpers(kind: TemporalKind): TemporalHelper[] {
  const timeOnly = kind === "time" || kind === "timetz";
  return HELPERS.filter((helper) => helper.times || !timeOnly).map((helper) => ({
    id: helper.id,
    label: helper.label,
    value: (now: Date) => formatTemporal(momentDate(helper.id, now), kind),
  }));
}

const SHORTCUTS: Record<string, Moment> = {
  "now()": "now",
  now: "now",
  jetzt: "now",
  current_timestamp: "now",
  "current_timestamp()": "now",
  localtimestamp: "now",
  "localtimestamp()": "now",
  current_time: "now",
  "current_time()": "now",
  localtime: "now",
  "localtime()": "now",
  "curtime()": "now",
  sysdate: "now",
  "sysdate()": "now",
  systimestamp: "now",
  "getdate()": "now",
  "sysdatetime()": "now",
  "sysdatetimeoffset()": "now",
  "datetime('now')": "now",
  current_date: "today",
  "current_date()": "today",
  "curdate()": "today",
  "today()": "today",
  today: "today",
  heute: "today",
  "date('now')": "today",
  yesterday: "yesterday",
  "yesterday()": "yesterday",
  gestern: "yesterday",
  tomorrow: "tomorrow",
  "tomorrow()": "tomorrow",
  morgen: "tomorrow",
};

export function resolveTemporalShortcut(
  text: string,
  kind: TemporalKind | null | undefined,
  now: Date,
): string | null {
  if (!kind) return null;
  const moment = SHORTCUTS[text.trim().toLowerCase().replace(/\s+/g, "")];
  if (!moment) return null;
  if (moment !== "now" && (kind === "time" || kind === "timetz")) return null;
  return formatTemporal(momentDate(moment, now), kind);
}
