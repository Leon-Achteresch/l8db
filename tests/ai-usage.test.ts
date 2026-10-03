import { expect, test } from "bun:test";
import { bypassAiPermissions, modeOptions } from "@/lib/ai/context";
import { mergeAiUsage, summarizeAiUsage } from "@/lib/ai/usage";
import type { AiProfile } from "@/lib/db/ai";

const profile = (provider: AiProfile["provider"], extra: Partial<AiProfile> = {}): AiProfile => ({
  id: provider,
  provider,
  binary: "",
  home: "",
  endpoint: "",
  model: "",
  effort: "",
  mode: "",
  ...extra,
});

test("BYOK streaming snapshots replace their round and accumulate distinct model rounds", () => {
  let usage = mergeAiUsage(
    {},
    {
      round: 1,
      usage: {
        prompt_tokens: 40,
        completion_tokens: 12,
        total_tokens: 52,
        prompt_tokens_details: { cached_tokens: 8 },
      },
    },
  );
  usage = mergeAiUsage(usage, {
    round: 1,
    usage: {
      prompt_tokens: 40,
      completion_tokens: 12,
      total_tokens: 52,
      prompt_tokens_details: { cached_tokens: 8 },
    },
  });
  usage = mergeAiUsage(usage, {
    round: 2,
    usage: {
      prompt_tokens: 90,
      completion_tokens: 7,
      total_tokens: 97,
      prompt_tokens_details: { cached_tokens: 32 },
    },
  });
  const result = summarizeAiUsage(usage, profile("compatible"), {}, []);
  expect(result).toMatchObject({
    input: 130,
    output: 19,
    total: 149,
    cached: 40,
    context: 97,
    cost: null,
    reported: true,
  });
});

test("Codex cumulative session usage remains separate from latest model context", () => {
  const patch = {
    tokenUsage: {
      total: {
        inputTokens: 1400,
        outputTokens: 100,
        totalTokens: 1500,
        cachedInputTokens: 1000,
        reasoningOutputTokens: 30,
      },
      last: { inputTokens: 600, outputTokens: 40, totalTokens: 640 },
      modelContextWindow: 200000,
    },
  };
  const data = mergeAiUsage(mergeAiUsage({}, patch), patch);
  const result = summarizeAiUsage(data, profile("codex", { model: "gpt-5.3-codex" }), {}, []);
  expect(result).toMatchObject({
    input: 1400,
    output: 100,
    reasoning: 30,
    cached: 1000,
    total: 1500,
    context: 640,
    contextLimit: 200000,
    contextEstimated: false,
    scope: "CLI-Sitzung",
    costReported: false,
  });
  expect(result.cost).toBeCloseTo((400 * 1.75 + 1000 * 0.175 + 100 * 14) / 1e6, 10);
});

test("OpenCode native context and zero provider cost are preserved without double counting cached input", () => {
  let data = mergeAiUsage(
    {},
    { context: { used: 21813, size: 200000, cost: { amount: 0, currency: "USD" } } },
  );
  data = mergeAiUsage(data, {
    usage: { inputTokens: 19874, outputTokens: 3, totalTokens: 21816, cachedReadTokens: 1939 },
  });
  expect(summarizeAiUsage(data, profile("opencode"), {}, [])).toMatchObject({
    input: 21813,
    output: 3,
    total: 21816,
    cached: 1939,
    context: 21813,
    contextLimit: 200000,
    cost: 0,
    costReported: true,
  });
});

test("Claude reports uncached input plus separate cache counts and actual multimodel cost", () => {
  const data = mergeAiUsage(
    {},
    {
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 20,
      },
      modelUsage: {
        "claude-opus-4-7": { inputTokens: 10, outputTokens: 5, contextWindow: 1000000 },
      },
      total_cost_usd: 0.003,
    },
  );
  const result = summarizeAiUsage(data, profile("claude"), {}, [
    { role: "user", text: "abcdefgh" },
  ]);
  expect(result).toMatchObject({
    input: 130,
    output: 5,
    total: 135,
    cached: 100,
    written: 20,
    cost: 0.003,
    costReported: true,
    contextLimit: 1000000,
    contextEstimated: true,
    context: 2,
    model: "claude-opus-4-7",
  });
});

test("Anthropic cache writes and reads are billed separately from uncached input", () => {
  const selected = profile("anthropic", {
    model: "private",
    pricing: {
      model: "private",
      inputUsd: 2,
      outputUsd: 10,
      cachedInputUsd: 0.2,
      cacheWriteUsd: 2.5,
    },
  });
  const data = mergeAiUsage(
    {},
    {
      round: 1,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 20,
      },
    },
  );
  expect(summarizeAiUsage(data, selected, {}, []).cost).toBeCloseTo(0.00014, 10);
});

test("one-hour Anthropic cache writes use their known premium without inflating tokens", () => {
  const data = mergeAiUsage(
    {},
    {
      round: 1,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 100,
        cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 },
      },
    },
  );
  const result = summarizeAiUsage(
    data,
    profile("anthropic", { model: "claude-haiku-4-5" }),
    {},
    [],
  );
  expect(result.total).toBe(100);
  expect(result.cost).toBeCloseTo((60 * 1.25 + 40 * 2) / 1e6, 10);
});

test("Google thinking contributes to output tokens and cached prompt is discounted once", () => {
  const selected = profile("google", {
    model: "private",
    pricing: { model: "private", inputUsd: 1, outputUsd: 2, cachedInputUsd: 0.1 },
  });
  const data = mergeAiUsage(
    {},
    {
      round: 1,
      usage: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 10,
        cachedContentTokenCount: 25,
        totalTokenCount: 130,
      },
    },
  );
  const result = summarizeAiUsage(data, selected, {}, []);
  expect(result).toMatchObject({ input: 100, output: 30, reasoning: 10, total: 130 });
  expect(result.cost).toBeCloseTo(0.0001375, 10);
});

test("unknown tariffs stay unknown, unknown limits fall back to 265k, and model changes do not reuse custom tariffs", () => {
  const selected = profile("compatible", {
    model: "changed",
    pricing: { model: "old", inputUsd: 1, outputUsd: 2, contextWindow: 10000 },
  });
  const data = mergeAiUsage({}, { usage: { inputTokens: 12, outputTokens: 8 } });
  expect(summarizeAiUsage(data, selected, {}, [])).toMatchObject({
    cost: null,
    contextLimit: 265_000,
  });
});

test("missing native usage has a visible text estimate rather than invented provider measurements", () => {
  const selected = profile("compatible", { pricing: { model: "", inputUsd: 2, outputUsd: 10 } });
  const result = summarizeAiUsage({}, selected, {}, [{ role: "user", text: "abcdefgh" }], "1234");
  expect(result).toMatchObject({
    input: 3,
    total: 3,
    context: 3,
    reported: false,
    contextEstimated: true,
    costReported: false,
    contextLimit: 265_000,
  });
  expect(result.cost).toBeCloseTo(0.000006, 10);
});

test("usage persistence strips arbitrary provider data and credentials", () => {
  const data = mergeAiUsage(
    {},
    {
      usage: { inputTokens: 12, key: "private-key", connectionString: "private-url" },
      modelUsage: { model: { inputTokens: 12, authorization: "private-token" } },
      rateLimits: { credits: { balance: "private-balance" } },
    },
  );
  expect(JSON.stringify(data)).not.toContain("private");
  expect(summarizeAiUsage(data, profile("codex"), {}, []).input).toBe(12);
});

test("native URI bypass modes never appear in selectable modes", () => {
  const uri = "https://agentclientprotocol.com/protocol/session-modes#autopilot";
  expect(bypassAiPermissions(uri)).toBe(true);
  expect(
    modeOptions({
      availableModes: [
        { id: uri, name: "Autopilot" },
        { id: "interactive", name: "Interactive" },
      ],
    }),
  ).toEqual([{ id: "interactive", name: "Interactive" }]);
});

test("missing cache-write tariffs remain unknown and native model aliases can estimate standard cost", () => {
  const data = mergeAiUsage(
    {},
    { usage: { inputTokens: 100, outputTokens: 10, cacheWriteInputTokens: 80 } },
  );
  expect(
    summarizeAiUsage(data, profile("codex", { model: "gpt-5.3-codex" }), {}, []).cost,
  ).toBeNull();
  const copilot = summarizeAiUsage(
    mergeAiUsage({}, { usage: { inputTokens: 100, outputTokens: 10 } }),
    profile("copilot", { model: "claude-sonnet-4.6" }),
    {},
    [],
  );
  expect(copilot.cost).toBeCloseTo(0.00045, 10);
});

test("text fallback estimates streamed output independently and avoids counting it as new input", () => {
  const selected = profile("compatible", { pricing: { model: "", inputUsd: 2, outputUsd: 10 } });
  const result = summarizeAiUsage({}, selected, {}, [
    { role: "user", text: "12345678" },
    { role: "assistant", text: "abcd" },
  ]);
  expect(result).toMatchObject({
    input: 2,
    output: 1,
    total: 3,
    reported: false,
    contextEstimated: true,
  });
  expect(result.cost).toBeCloseTo(0.000014, 10);
});

test("custom standard-model tariffs still apply after actual native model identity is stored", () => {
  const selected = profile("codex", {
    model: "gpt-5.6-sol",
    pricing: { model: "", inputUsd: 1, outputUsd: 2, contextWindow: 20000 },
  });
  const data = mergeAiUsage({}, { usage: { inputTokens: 100, outputTokens: 10 } });
  const result = summarizeAiUsage(data, selected, { requestedModel: "" }, []);
  expect(result).toMatchObject({
    cost: 0.00012,
    contextLimit: 20000,
    custom: true,
    model: "gpt-5.6-sol",
  });
});
