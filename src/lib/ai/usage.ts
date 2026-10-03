import type { AiMessage, AiPricing, AiProfile } from "@/lib/db/ai";

export type AiUsageData = Record<string, unknown>;
interface Counts {
  input: number;
  output: number;
  cached: number;
  written: number;
  writtenLong: number;
  reasoning: number;
  total: number;
  reported: boolean;
}
interface Rates {
  input: number;
  output: number;
  cached: number;
  written: number;
  writeKnown?: boolean;
  upper?: Rates;
  source: string;
}
export interface AiUsageSummary extends Counts {
  context: number;
  contextLimit: number;
  contextEstimated: boolean;
  scope: string;
  cost: number | null;
  costUpper: number | null;
  costReported: boolean;
  currency: string;
  model: string;
  source: string | null;
  custom: boolean;
}
const object = (value: unknown): AiUsageData =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as AiUsageData) : {};
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const first = (...values: unknown[]) => values.map(number).find((value) => value !== null) ?? 0;
const numericKeys = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "reasoningOutputTokens",
  "cachedReadTokens",
  "cachedWriteTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
  "thinkingTokens",
  "thoughtTokens",
  "promptTokenCount",
  "candidatesTokenCount",
  "cachedContentTokenCount",
  "thoughtsTokenCount",
  "totalTokenCount",
  "contextWindow",
  "costUSD",
  "maxOutputTokens",
  "modelContextWindow",
  "used",
  "size",
  "amount",
];
function safeCounts(value: unknown): AiUsageData {
  const source = object(value);
  const result: AiUsageData = {};
  for (const key of numericKeys) if (number(source[key]) !== null) result[key] = source[key];
  for (const key of [
    "prompt_tokens_details",
    "completion_tokens_details",
    "output_tokens_details",
    "cache_creation",
    "total",
    "last",
    "cost",
  ]) {
    if (source[key] && typeof source[key] === "object") result[key] = safeCounts(source[key]);
  }
  for (const key of [
    "cached_tokens",
    "reasoning_tokens",
    "thinking_tokens",
    "ephemeral_5m_input_tokens",
    "ephemeral_1h_input_tokens",
  ])
    if (number(source[key]) !== null) result[key] = source[key];
  if (typeof source.currency === "string" && /^[A-Z]{3}$/.test(source.currency))
    result.currency = source.currency;
  return result;
}
export function mergeAiUsage(previous: AiUsageData, patch: AiUsageData): AiUsageData {
  const next = { ...previous };
  if (number(patch.round) !== null && patch.usage) {
    const rounds = object(previous.rounds);
    const id = String(patch.round);
    next.rounds = { ...rounds, [id]: { ...object(rounds[id]), ...safeCounts(patch.usage) } };
  } else if (patch.usage) next.usage = { ...object(previous.usage), ...safeCounts(patch.usage) };
  for (const key of ["tokenUsage", "context"]) if (patch[key]) next[key] = safeCounts(patch[key]);
  if (patch.modelUsage)
    next.modelUsage = Object.fromEntries(
      Object.entries(object(patch.modelUsage))
        .slice(0, 32)
        .map(([model, usage]) => [model, safeCounts(usage)]),
    );
  if (number(patch.total_cost_usd) !== null) next.total_cost_usd = patch.total_cost_usd;
  if (!patch.usage && numericKeys.some((key) => number(patch[key]) !== null))
    next.usage = { ...object(previous.usage), ...safeCounts(patch) };
  return next;
}
function counts(value: unknown): Counts {
  const usage = object(value);
  const cached = first(
    usage.cache_read_input_tokens,
    usage.cachedInputTokens,
    usage.cachedReadTokens,
    usage.cacheReadInputTokens,
    usage.cachedContentTokenCount,
    object(usage.prompt_tokens_details).cached_tokens,
  );
  const writtenLong = first(object(usage.cache_creation).ephemeral_1h_input_tokens);
  const written = first(
    usage.cache_creation_input_tokens,
    usage.cacheWriteInputTokens,
    usage.cachedWriteTokens,
    usage.cacheCreationInputTokens,
    writtenLong + first(object(usage.cache_creation).ephemeral_5m_input_tokens),
  );
  const reasoning = first(
    usage.reasoningOutputTokens,
    usage.thoughtTokens,
    usage.thinkingTokens,
    usage.thoughtsTokenCount,
    object(usage.completion_tokens_details).reasoning_tokens,
    object(usage.output_tokens_details).thinking_tokens,
  );
  let input = first(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.promptTokenCount,
  );
  let output = first(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.candidatesTokenCount,
  );
  const total = first(usage.total_tokens, usage.totalTokens, usage.totalTokenCount);
  if ("input_tokens" in usage) input += cached + written;
  else if (
    "inputTokens" in usage &&
    total >= input + output + cached + written &&
    cached + written > 0
  )
    input += cached + written;
  if ("candidatesTokenCount" in usage) output += reasoning;
  return {
    input,
    output,
    cached,
    written,
    writtenLong,
    reasoning,
    total: total || input + output,
    reported: [
      "input_tokens",
      "prompt_tokens",
      "inputTokens",
      "promptTokenCount",
      "output_tokens",
      "outputTokens",
      "totalTokens",
    ].some((key) => number(usage[key]) !== null),
  };
}
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const ANTHROPIC = "https://platform.claude.com/docs/en/about-claude/pricing";
const GOOGLE = "https://ai.google.dev/gemini-api/docs/pricing";
const rates = (
  input: number,
  output: number,
  cached: number,
  written: number,
  source: string,
  upper?: [number, number, number, number],
): Rates => ({
  input,
  output,
  cached,
  written,
  source,
  upper: upper ? rates(...upper, source) : undefined,
});
const CATALOG: Record<string, Rates> = {
  "gpt-6-astra": rates(10, 50, 1, 12.5, OPENAI, [20, 75, 2, 25]),
  "gpt-6.1-sol": rates(2, 10, 0.1, 2.5, OPENAI, [4, 15, 0.2, 5]),
  "gpt-6-luna": rates(0.1, 0.5, 0.01, 0.125, OPENAI, [0.2, 0.75, 0.02, 0.25]),
  "gpt-5.6-sol": rates(4, 20, 0.4, 5, OPENAI, [8, 30, 0.8, 10]),
  "gpt-5.3-codex": { ...rates(1.75, 14, 0.175, 0, OPENAI), writeKnown: false },
  "claude-fable-5-1": rates(10, 50, 0.25, 12.5, ANTHROPIC),
  "claude-opus-5-5": rates(4, 20, 0.2, 5, ANTHROPIC),
  "claude-sonnet-5-5": rates(2, 10, 0.2, 2.5, ANTHROPIC),
  "claude-sonnet-5": rates(2, 10, 0.2, 2.5, ANTHROPIC),
  "claude-haiku-4-5": rates(1, 5, 0.1, 1.25, ANTHROPIC),
  "claude-sonnet-4-6": rates(3, 15, 0.3, 3.75, ANTHROPIC),
  "claude-sonnet-4-5": rates(3, 15, 0.3, 3.75, ANTHROPIC),
  "gemini-3.8-flash": { ...rates(0.75, 3.75, 0.075, 0, GOOGLE), writeKnown: false },
};
for (const id of [
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
])
  CATALOG[id] = rates(5, 25, 0.5, 6.25, ANTHROPIC);
function modelRates(model: string, profile: AiProfile): Rates | null {
  const custom = profile.pricing;
  if (
    custom &&
    custom.model === profile.model &&
    number(custom.inputUsd) !== null &&
    number(custom.outputUsd) !== null
  )
    return rates(
      custom.inputUsd ?? 0,
      custom.outputUsd ?? 0,
      number(custom.cachedInputUsd) ?? custom.inputUsd ?? 0,
      number(custom.cacheWriteUsd) ?? custom.inputUsd ?? 0,
      "custom",
    );
  if (profile.provider === "compatible") return null;
  const id = model
    .toLowerCase()
    .replace(/^(openai|anthropic|google)\//, "")
    .replace(/-\d{8}$/, "")
    .replace(/^(claude-(?:opus|sonnet|haiku)-\d+)\.(\d+)$/, "$1-$2");
  if (id === "gemini-3.8-flash" && Date.now() > Date.parse("2026-12-31T23:59:59Z")) return null;
  return CATALOG[id] ?? null;
}
function estimate(value: Counts, price: Rates): number {
  return (
    (Math.max(0, value.input - value.cached - value.written) * price.input +
      value.output * price.output +
      value.cached * price.cached +
      (value.written - value.writtenLong) * price.written +
      value.writtenLong * price.written * (price.source === ANTHROPIC ? 1.6 : 1)) /
    1_000_000
  );
}
export function summarizeAiUsage(
  data: AiUsageData,
  profile: AiProfile,
  metadata: AiUsageData,
  messages: AiMessage[],
  prompt = "",
): AiUsageSummary {
  const token = object(data.tokenUsage);
  const native = object(data.context);
  const models = Object.entries(object(data.modelUsage));
  const primary =
    models.find(([id]) => id === profile.model) ??
    [...models].sort((a, b) => counts(b[1]).input - counts(a[1]).input)[0];
  const currentModels = object(metadata.models);
  const model =
    profile.model ||
    (typeof metadata.model === "string" ? metadata.model : "") ||
    (typeof currentModels.currentModelId === "string" ? currentModels.currentModelId : "") ||
    primary?.[0] ||
    "";
  const rounds = Object.values(object(data.rounds));
  const entries = rounds.length ? rounds.map(counts) : [counts(token.total ?? data.usage)];
  const sum = entries.reduce<Counts>(
    (a, b) => ({
      input: a.input + b.input,
      output: a.output + b.output,
      cached: a.cached + b.cached,
      written: a.written + b.written,
      writtenLong: a.writtenLong + b.writtenLong,
      reasoning: a.reasoning + b.reasoning,
      total: a.total + b.total,
      reported: a.reported || b.reported,
    }),
    {
      input: 0,
      output: 0,
      cached: 0,
      written: 0,
      writtenLong: 0,
      reasoning: 0,
      total: 0,
      reported: false,
    },
  );
  const textTokens = Math.ceil(
    (messages.reduce((length, message) => length + message.text.length, 0) + prompt.length) / 4,
  );
  const estimatedOutput =
    messages.at(-1)?.role === "assistant" ? Math.ceil((messages.at(-1)?.text.length ?? 0) / 4) : 0;
  const estimatedCounts = {
    ...sum,
    input: Math.max(0, textTokens - estimatedOutput),
    output: estimatedOutput,
    total: textTokens,
  };
  const latest = rounds.length ? entries.at(-1) : counts(token.last ?? data.usage ?? primary?.[1]);
  const contextMeasured = Boolean(token.last || rounds.length || (data.usage && !data.modelUsage));
  const context =
    number(native.used) ?? (contextMeasured && latest?.reported ? latest.total : textTokens);
  const custom: AiPricing | undefined =
    profile.pricing?.model ===
    (typeof metadata.requestedModel === "string" ? metadata.requestedModel : profile.model)
      ? profile.pricing
      : undefined;
  const limit =
    number(native.size) ??
    number(token.modelContextWindow) ??
    number(object(primary?.[1]).contextWindow) ??
    number(custom?.contextWindow);
  const nativeCost = object(native.cost);
  const reportedCost = number(data.total_cost_usd) ?? number(nativeCost.amount);
  const requestedModel =
    typeof metadata.requestedModel === "string" ? metadata.requestedModel : profile.model;
  const priceProfile = { ...profile, model: requestedModel };
  const price = modelRates(model, priceProfile);
  let cost: number | null = reportedCost;
  let upper: number | null = null;
  if (cost === null && price && (!sum.written || price.writeKnown !== false)) {
    if (models.length > 1 && reportedCost === null) {
      const prices = models.map(([id, usage]) => ({
        value: counts(usage),
        rates: modelRates(id, { ...profile, pricing: undefined }),
      }));
      if (
        prices.every(
          (entry) => entry.rates && (!entry.value.written || entry.rates.writeKnown !== false),
        )
      )
        cost = prices.reduce(
          (total, entry) => total + estimate(entry.value, entry.rates as Rates),
          0,
        );
    } else {
      const estimated = sum.reported ? sum : estimatedCounts;
      cost = estimate(estimated, price);
      if (price.upper) upper = estimate(sum.reported ? sum : estimatedCounts, price.upper);
    }
  }
  return {
    ...sum,
    input: sum.reported ? sum.input : estimatedCounts.input,
    output: sum.reported ? sum.output : estimatedOutput,
    total: sum.reported ? sum.total : textTokens,
    context,
    contextLimit: limit && limit > 0 ? limit : 265_000,
    contextEstimated: number(native.used) === null && (!contextMeasured || !latest?.reported),
    scope: token.total ? "CLI-Sitzung" : "Anfrage",
    cost,
    costUpper: upper,
    costReported: reportedCost !== null,
    currency: typeof nativeCost.currency === "string" ? nativeCost.currency : "USD",
    model,
    source: price?.source ?? null,
    custom: price?.source === "custom",
  };
}
