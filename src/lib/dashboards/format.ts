import {
  type CompareMode,
  PERIOD_LABEL,
  type Period,
  type TimeBucket,
  type WidgetOptions,
} from "./model";

type ValueFormat = Pick<WidgetOptions, "unit" | "decimals">;

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_LONG = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    formatters.set(key, format);
  }
  return format;
}

function withUnit(text: string, unit: string): string {
  return unit ? `${text} ${unit}` : text;
}

export function fmtNumber(value: number, decimals: number | null = null): string {
  return decimals === null
    ? numberFormat(0, 2).format(value)
    : numberFormat(decimals, decimals).format(value);
}

export function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${numberFormat(0, 1).format(value / 1e9)} Mrd.`;
  if (abs >= 1e6) return `${numberFormat(0, 1).format(value / 1e6)} Mio.`;
  if (abs >= 1e4) return `${numberFormat(0, abs >= 1e5 ? 0 : 1).format(value / 1e3)} Tsd.`;
  return numberFormat(0, abs >= 10 ? 0 : 2).format(value);
}

export function fmtValue(value: number, format: ValueFormat): string {
  return withUnit(fmtNumber(value, format.decimals), format.unit);
}

export function fmtValueCompact(value: number, format: ValueFormat): string {
  const abs = Math.abs(value);
  const text =
    abs < 1e4 && format.decimals !== null ? fmtNumber(value, format.decimals) : fmtCompact(value);
  return withUnit(text, format.unit);
}

export function fmtShare(part: number, total: number): string {
  const share = total ? (part / total) * 100 : 0;
  return `${numberFormat(0, share < 10 ? 1 : 0).format(share)} %`;
}

export type DimKind = Exclude<TimeBucket, "none"> | "category";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const ISO_QUARTER = /^(\d{4})-Q([1-4])$/;
const ISO_WEEK = /^(\d{4})-W(\d{1,2})$/;
const ISO_YEAR = /^(\d{4})$/;

export function dimKind(values: string[], bucket: TimeBucket | null = null): DimKind {
  const sample = values.filter((value) => value && value !== "—");
  if (!sample.length) return "category";
  if (sample.every((v) => ISO_QUARTER.test(v))) return "quarter";
  if (sample.every((v) => ISO_WEEK.test(v))) return "week";
  if (sample.every((v) => ISO_MONTH.test(v))) return "month";
  if (bucket === "year" && sample.every((v) => ISO_YEAR.test(v) || ISO_DAY.test(v))) return "year";
  if (!sample.every((v) => ISO_DAY.test(v))) return "category";
  if (bucket && bucket !== "none") return bucket;
  if (sample.every((v) => v.endsWith("-01-01")) && sample.length > 1) return "year";
  if (sample.every((v) => v.endsWith("-01")) && sample.length > 1) return "month";
  return "day";
}

function parts(value: string) {
  const day = ISO_DAY.exec(value);
  if (day) return { year: day[1], month: Number(day[2]), day: Number(day[3]) };
  const month = ISO_MONTH.exec(value);
  if (month) return { year: month[1], month: Number(month[2]), day: 1 };
  const year = ISO_YEAR.exec(value);
  if (year) return { year: year[1], month: 1, day: 1 };
  return null;
}

export function fmtDim(value: string, kind: DimKind, first = false): string {
  if (kind === "category") return value;
  const quarter = ISO_QUARTER.exec(value);
  if (quarter) return `Q${quarter[2]} ’${quarter[1].slice(2)}`;
  const week = ISO_WEEK.exec(value);
  if (week) return `KW ${Number(week[2])}`;
  const p = parts(value);
  if (!p) return value;
  switch (kind) {
    case "year":
      return p.year;
    case "quarter":
      return `Q${Math.ceil(p.month / 3)} ’${p.year.slice(2)}`;
    case "month":
      return first || p.month === 1
        ? `${MONTHS[p.month - 1]} ’${p.year.slice(2)}`
        : MONTHS[p.month - 1];
    default:
      return `${p.day}. ${MONTHS[p.month - 1]}`;
  }
}

export function fmtDimLong(value: string, kind: DimKind): string {
  if (kind === "category") return value;
  const quarter = ISO_QUARTER.exec(value);
  if (quarter) return `${quarter[2]}. Quartal ${quarter[1]}`;
  const week = ISO_WEEK.exec(value);
  if (week) return `KW ${Number(week[2])} ${week[1]}`;
  const p = parts(value);
  if (!p) return value;
  switch (kind) {
    case "year":
      return p.year;
    case "quarter":
      return `${Math.ceil(p.month / 3)}. Quartal ${p.year}`;
    case "month":
      return `${MONTHS_LONG[p.month - 1]} ${p.year}`;
    case "week":
      return `Woche ab ${p.day}. ${MONTHS[p.month - 1]} ${p.year}`;
    default:
      return `${p.day}. ${MONTHS_LONG[p.month - 1]} ${p.year}`;
  }
}

const PREVIOUS_LABEL: Record<Exclude<Period, "all">, string> = {
  "7d": "ggü. Vorwoche",
  "30d": "ggü. vorherigen 30 Tagen",
  "90d": "ggü. vorherigen 90 Tagen",
  "12m": "ggü. vorherigen 12 Monaten",
  quarter: "ggü. Vorquartal",
  year: "ggü. Vorjahr",
};

const PREVIOUS_SHORT: Record<Exclude<Period, "all">, string> = {
  "7d": "Vorwoche",
  "30d": "Vorperiode",
  "90d": "Vorperiode",
  "12m": "Vorperiode",
  quarter: "Vorquartal",
  year: "Vorjahr",
};

export function compareLabel(period: Exclude<Period, "all">, compare: CompareMode): string {
  return compare === "year" ? "ggü. Vorjahr" : PREVIOUS_LABEL[period];
}

export function compareShortLabel(period: Exclude<Period, "all">, compare: CompareMode): string {
  return compare === "year" ? "Vorjahr" : PREVIOUS_SHORT[period];
}

const STEP_LABEL: Record<DimKind, string> = {
  day: "ggü. Vortag",
  week: "ggü. Vorwoche",
  month: "ggü. Vormonat",
  quarter: "ggü. Vorquartal",
  year: "ggü. Vorjahr",
  category: "ggü. Vorwert",
};

export function stepLabel(kind: DimKind): string {
  return STEP_LABEL[kind];
}

const BUCKET_ADVERB: Record<Exclude<TimeBucket, "none">, string> = {
  day: "Täglich",
  week: "Wöchentlich",
  month: "Monatlich",
  quarter: "Quartalsweise",
  year: "Jährlich",
};

export function autoSubtitle(
  bucket: TimeBucket | null,
  period: Period | null,
  unit: string,
): string {
  return [
    bucket && bucket !== "none" ? BUCKET_ADVERB[bucket] : "",
    period && period !== "all" ? PERIOD_LABEL[period] : "",
    unit ? `in ${unit}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
