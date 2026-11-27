import type { AiUsageSummary } from "./usage";

export interface AiSpend {
  input: number;
  output: number;
  cached: number;
  cost: number;
  requests: number;
  unpriced: number;
}
export type AiSpendLog = Record<string, Record<string, AiSpend>>;
export interface AiSpendReport {
  total: AiSpend;
  series: { day: string; cost: number; tokens: number }[];
  models: { model: string; spend: AiSpend }[];
}
export const AI_SPEND_KEY = "l8db.ai.spend";
export const AI_SPEND_DAYS = 120;
export const AI_SPEND_MODELS = 24;
const FIELDS = ["input", "output", "cached", "cost", "requests", "unpriced"] as const;
const OTHER = "Weitere";
const empty = (): AiSpend => ({
  input: 0,
  output: 0,
  cached: 0,
  cost: 0,
  requests: 0,
  unpriced: 0,
});

export function cleanSpend(value: unknown): AiSpend {
  const spend = empty();
  for (const field of FIELDS) {
    const number = (value as Record<string, unknown> | null)?.[field];
    if (typeof number === "number" && Number.isFinite(number) && number >= 0) spend[field] = number;
  }
  return spend;
}

export function addSpend(a: AiSpend, b: AiSpend): AiSpend {
  const result = empty();
  for (const field of FIELDS) result[field] = a[field] + b[field];
  return result;
}

function spendOf(usage: AiUsageSummary): AiSpend {
  const priced = usage.cost !== null && usage.currency === "USD";
  return {
    input: usage.input,
    output: usage.output,
    cached: usage.cached,
    cost: priced ? (usage.cost ?? 0) : 0,
    requests: 1,
    unpriced: priced ? 0 : 1,
  };
}

function spendDelta(current: AiSpend, seen?: AiSpend): AiSpend {
  if (
    !seen ||
    current.input < seen.input ||
    current.output < seen.output ||
    current.cost < seen.cost
  )
    return current;
  return {
    input: current.input - seen.input,
    output: current.output - seen.output,
    cached: Math.max(0, current.cached - seen.cached),
    cost: current.cost - seen.cost,
    requests: 1,
    unpriced: current.unpriced,
  };
}

export function settleAiSpend(
  usage: AiUsageSummary,
  previous: { spend?: AiSpend; spendSeen?: AiSpend },
): { delta: AiSpend; spend: AiSpend; spendSeen?: AiSpend } | null {
  if (!usage.reported) return null;
  const current = spendOf(usage);
  const cumulative = usage.scope === "CLI-Sitzung";
  const delta = cumulative ? spendDelta(current, previous.spendSeen) : current;
  return {
    delta,
    spend: addSpend(previous.spend ?? empty(), delta),
    spendSeen: cumulative ? current : undefined,
  };
}

export function spendDay(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addToSpendLog(
  log: AiSpendLog,
  day: string,
  model: string,
  spend: AiSpend,
): AiSpendLog {
  const entries = { ...log[day] };
  const name = model.slice(0, 80) || "Unbekannt";
  const key = name in entries || Object.keys(entries).length < AI_SPEND_MODELS ? name : OTHER;
  entries[key] = addSpend(entries[key] ?? empty(), spend);
  const next = { ...log, [day]: entries };
  const days = Object.keys(next).sort();
  for (const old of days.slice(0, Math.max(0, days.length - AI_SPEND_DAYS))) delete next[old];
  return next;
}

export function parseSpendLog(raw: string | null): AiSpendLog {
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const log: AiSpendLog = {};
  for (const [day, models] of Object.entries(data).sort().slice(-AI_SPEND_DAYS)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !models || typeof models !== "object") continue;
    const entries: Record<string, AiSpend> = {};
    for (const [model, value] of Object.entries(models).slice(0, AI_SPEND_MODELS + 1))
      entries[model.slice(0, 80)] = cleanSpend(value);
    log[day] = entries;
  }
  return log;
}

export function readAiSpendLog(): AiSpendLog {
  try {
    return parseSpendLog(localStorage.getItem(AI_SPEND_KEY));
  } catch {
    return {};
  }
}

export function recordAiSpend(model: string, spend: AiSpend, now = Date.now()) {
  try {
    localStorage.setItem(
      AI_SPEND_KEY,
      JSON.stringify(addToSpendLog(readAiSpendLog(), spendDay(now), model, spend)),
    );
  } catch {}
}

export function summarizeAiSpend(log: AiSpendLog, days: number, now = Date.now()): AiSpendReport {
  let total = empty();
  const models = new Map<string, AiSpend>();
  const series: AiSpendReport["series"] = [];
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - days + 1);
  for (let index = 0; index < days; index++) {
    const day = spendDay(cursor.getTime());
    let cost = 0;
    let tokens = 0;
    for (const [model, spend] of Object.entries(log[day] ?? {})) {
      total = addSpend(total, spend);
      models.set(model, addSpend(models.get(model) ?? empty(), spend));
      cost += spend.cost;
      tokens += spend.input + spend.output;
    }
    series.push({ day, cost, tokens });
    cursor.setDate(cursor.getDate() + 1);
  }
  return {
    total,
    series,
    models: [...models]
      .map(([model, spend]) => ({ model, spend }))
      .sort(
        (a, b) =>
          b.spend.cost - a.spend.cost ||
          b.spend.input + b.spend.output - a.spend.input - a.spend.output,
      ),
  };
}
