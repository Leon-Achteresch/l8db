import { expect, test } from "bun:test";
import { aiCurrencyRate, formatAiCost, parseAiRates } from "@/lib/ai/currency";
import {
  AI_LIMIT_WINDOWS,
  activeAiLimits,
  aiLimitReset,
  mergeAiLimits,
  parseAiLimits,
} from "@/lib/ai/limits";
import {
  AI_SPEND_DAYS,
  AI_SPEND_MODELS,
  type AiSpend,
  type AiSpendLog,
  addToSpendLog,
  parseSpendLog,
  settleAiSpend,
  spendDay,
  summarizeAiSpend,
} from "@/lib/ai/spend";
import { summarizeAiUsage } from "@/lib/ai/usage";
import type { AiProfile } from "@/lib/db/ai";

const profile: AiProfile = {
  id: "anthropic",
  provider: "anthropic",
  binary: "",
  home: "",
  endpoint: "",
  model: "claude-sonnet-5-5",
  effort: "",
  mode: "",
};
const spend = (cost: number, input = 1000): AiSpend => ({
  input,
  output: 100,
  cached: 0,
  cost,
  requests: 1,
  unpriced: 0,
});

test("a request adds to the conversation total and reports the cache saving", () => {
  const usage = summarizeAiUsage(
    {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 9000,
      },
    },
    profile,
    {},
    [],
  );
  expect(usage.cacheSavings).toBeCloseTo((9000 * (2 - 0.2)) / 1_000_000, 10);
  const first = settleAiSpend(usage, {});
  expect(first?.delta).toMatchObject({ input: 10_000, output: 500, cached: 9000, requests: 1 });
  expect(first?.spendSeen).toBeUndefined();
  const second = settleAiSpend(usage, { spend: first?.spend });
  expect(second?.spend.requests).toBe(2);
  expect(second?.spend.cost).toBeCloseTo((usage.cost ?? 0) * 2, 10);
});

test("unreported usage is not recorded and unknown tariffs count as unpriced", () => {
  expect(settleAiSpend(summarizeAiUsage({}, profile, {}, []), {})).toBeNull();
  const unknown = settleAiSpend(
    summarizeAiUsage(
      { usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { ...profile, provider: "compatible", model: "local" },
      {},
      [],
    ),
    {},
  );
  expect(unknown?.delta).toMatchObject({ cost: 0, unpriced: 1 });
});

test("cumulative CLI totals only add what the request spent", () => {
  const codex = { ...profile, provider: "codex" as const, model: "gpt-6.1-sol" };
  const at = (input: number) =>
    summarizeAiUsage(
      { tokenUsage: { total: { inputTokens: input, outputTokens: input / 10 } } },
      codex,
      {},
      [],
    );
  const first = settleAiSpend(at(1000), {});
  const second = settleAiSpend(at(2500), { spend: first?.spend, spendSeen: first?.spendSeen });
  expect(second?.delta).toMatchObject({ input: 1500, output: 150, requests: 1 });
  expect(second?.spend).toMatchObject({ input: 2500, output: 250, requests: 2 });
  const restarted = settleAiSpend(at(400), second ?? {});
  expect(restarted?.delta.input).toBe(400);
});

test("the log keeps a bounded number of days and models and survives broken storage", () => {
  let log: AiSpendLog = {};
  for (let day = 0; day < AI_SPEND_DAYS + 30; day++)
    log = addToSpendLog(log, spendDay(Date.UTC(2026, 0, 1 + day, 12)), "m", spend(1));
  expect(Object.keys(log)).toHaveLength(AI_SPEND_DAYS);
  for (let model = 0; model < AI_SPEND_MODELS + 10; model++)
    log = addToSpendLog(log, "2026-06-01", `model-${model}`, spend(1));
  expect(Object.keys(log["2026-06-01"])).toHaveLength(AI_SPEND_MODELS + 1);
  expect(log["2026-06-01"].Weitere.requests).toBe(10);
  expect(parseSpendLog(JSON.stringify(log))).toEqual(log);
  expect(parseSpendLog("{broken")).toEqual({});
  expect(parseSpendLog('{"2026-06-01":{"m":{"cost":-5,"input":"x","requests":2}}}')).toEqual({
    "2026-06-01": { m: { input: 0, output: 0, cached: 0, cost: 0, requests: 2, unpriced: 0 } },
  });
});

test("the report fills empty days and ranks models by cost", () => {
  const now = new Date(2026, 10, 24, 15).getTime();
  let log: AiSpendLog = {};
  log = addToSpendLog(log, "2026-11-24", "cheap", spend(0.5));
  log = addToSpendLog(log, "2026-11-22", "costly", spend(2));
  log = addToSpendLog(log, "2026-11-10", "old", spend(9));
  const report = summarizeAiSpend(log, 7, now);
  expect(report.series.map((entry) => entry.day)).toEqual([
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
    "2026-11-23",
    "2026-11-24",
  ]);
  expect(report.total.cost).toBe(2.5);
  expect(report.models.map((entry) => entry.model)).toEqual(["costly", "cheap"]);
  expect(summarizeAiSpend(log, 30, now).total.cost).toBe(11.5);
});

test("costs convert with the reference or manual rate and fall back to USD", () => {
  const rates = parseAiRates({
    date: "2026-11-23",
    rates: { EUR: 0.91416, CHF: 0.83975, XXX: 4, GBP: "bad", JPY: -1 },
  });
  expect(rates).toEqual({ date: "2026-11-23", rates: { EUR: 0.91416, CHF: 0.83975 } });
  expect(parseAiRates(null)).toEqual({ date: "", rates: {} });
  const euro = { code: "EUR", manual: null, rates: rates.rates };
  const format = (...args: Parameters<typeof formatAiCost>) =>
    formatAiCost(...args).replace(/\u00a0/g, " ");
  expect(aiCurrencyRate(euro)).toBe(0.91416);
  expect(format(10, euro)).toBe("9,14 €");
  expect(format(10, { ...euro, manual: 0.5 })).toBe("5,00 €");
  expect(format(10, { code: "GBP", manual: null, rates: rates.rates })).toBe("10,00 $");
  expect(format(10, euro, "CAD")).toBe("10,00 CA$");
  expect(format(0.00123, { code: "USD", manual: null, rates: {} })).toBe("0,00123 $");
  expect(format(0.083, euro)).toBe("0,076 €");
});

test("Claude Code and Codex limit events become windows with usage and reset time", () => {
  const claude = parseAiLimits({
    rateLimit: {
      status: "allowed",
      resetsAt: 1795526400,
      rateLimitType: "five_hour",
      overageStatus: "rejected",
      isUsingOverage: false,
      unifiedWindows: {
        five_hour: { utilization: 0.23, resetsAt: 1795526400, status: "allowed" },
        seven_day: { utilization: 0.12, resetsAt: 1796032800, status: "allowed" },
      },
    },
  });
  expect(claude).toEqual([
    { id: "five_hour", label: "5 Std.", used: 23, resetsAt: 1795526400000, rejected: false },
    { id: "seven_day", label: "Woche", used: 12, resetsAt: 1796032800000, rejected: false },
  ]);
  expect(
    parseAiLimits({
      rateLimit: { status: "rejected", rateLimitType: "seven_day_opus", resetsAt: 1796032800 },
    }),
  ).toEqual([
    {
      id: "seven_day_opus",
      label: "Woche · Opus",
      used: 100,
      resetsAt: 1796032800000,
      rejected: true,
    },
  ]);
  const codex = parseAiLimits({
    rateLimits: {
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: 41, windowDurationMins: 300, resetsAt: 1795526400 },
      secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: null },
      credits: null,
      planType: "plus",
    },
  });
  expect(codex).toEqual([
    { id: "codex:primary", label: "5 Std.", used: 41, resetsAt: 1795526400000, rejected: false },
    { id: "codex:secondary", label: "Woche", used: 100, resetsAt: null, rejected: true },
  ]);
  expect(parseAiLimits({ usage: { input_tokens: 5 } })).toEqual([]);
  expect(parseAiLimits({ rateLimits: { primary: { usedPercent: "x" } }, rateLimit: 7 })).toEqual(
    [],
  );
});

test("sparse limit updates merge by window, expired windows disappear and the list stays bounded", () => {
  const now = 1795500000000;
  const first = parseAiLimits({
    rateLimits: {
      primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1795526400 },
      secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1796032800 },
    },
  });
  const update = parseAiLimits({
    rateLimits: { primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: 1795526400 } },
  });
  const merged = mergeAiLimits(first, update, now);
  expect(merged.map((limit) => [limit.id, limit.used])).toEqual([
    [":primary", 55],
    [":secondary", 5],
  ]);
  expect(activeAiLimits(merged, 1795526400001).map((limit) => limit.id)).toEqual([":secondary"]);
  expect(mergeAiLimits(merged, [], 1796032800001)).toEqual([]);
  let many = merged;
  for (let index = 0; index < 50; index++)
    many = mergeAiLimits(
      many,
      [{ id: `w${index}`, label: "x", used: 1, resetsAt: null, rejected: false }],
      now,
    );
  expect(many).toHaveLength(AI_LIMIT_WINDOWS);
  expect(
    aiLimitReset(new Date(2026, 10, 24, 14, 5).getTime(), new Date(2026, 10, 24, 9).getTime()),
  ).toBe("14:05");
  expect(
    aiLimitReset(new Date(2026, 10, 30, 9, 0).getTime(), new Date(2026, 10, 24, 9).getTime()),
  ).toBe("Mo 09:00");
  expect(aiLimitReset(null)).toBe("");
});
