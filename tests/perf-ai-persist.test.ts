import { expect, test } from "bun:test";
import { type AiSession, serializeAiData } from "@/lib/ai/store";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const output = "x".repeat(16_000);

function session(index: number, text = output): AiSession {
  return {
    id: `s${index}`,
    title: `Chat ${index}`,
    profileId: "copilot",
    nativeId: null,
    cwd: "/tmp",
    connectionIds: [],
    updatedAt: 1_000 + index,
    messages: Array.from({ length: 20 }, (_, message) => ({
      id: `m${message}`,
      role: message % 2 ? ("assistant" as const) : ("user" as const),
      text: `Antwort ${index}/${message}`,
      rich: Array.from({ length: 16 }, (_, tool) => ({
        type: "tool" as const,
        id: `t${tool}`,
        name: "l8db_ai_search",
        status: "success",
        output: text,
      })),
    })),
  };
}

test("AI persistence stays inside the storage budget for heavy tool histories", async () => {
  const data = {
    profiles: [],
    servers: [],
    sessions: Array.from({ length: 12 }, (_, index) => session(index)),
  };
  const rawChars = JSON.stringify(data).length;
  const durations: number[] = [];
  let value = "";
  for (let run = 0; run < 10; run++) {
    const start = performance.now();
    value = serializeAiData(data);
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const medianMs = durations[5];
  const p95Ms = durations[9];
  const stored = JSON.parse(value) as { sessions: AiSession[] };
  expect(rawChars).toBeGreaterThan(20_000_000);
  expect(value.length).toBeLessThanOrEqual(2_000_000);
  expect(stored.sessions).toHaveLength(12);
  expect(stored.sessions.every((entry) => entry.messages.length === 20)).toBe(true);
  expect(stored.sessions.at(-1)?.messages[1].text).toBe("Antwort 11/1");
  expect(p95Ms).toBeLessThan(400);
  await reportScenario("ai-persist-budget", {
    sessions: 12,
    toolBlocks: 12 * 20 * 16,
    rawChars,
    storedChars: value.length,
    medianMs,
    p95Ms,
  });
});

test("AI persistence serializes an in-budget history in one pass", async () => {
  const data = {
    profiles: [],
    sessions: Array.from({ length: 12 }, (_, index) => session(index, "x".repeat(400))),
    servers: [],
  };
  const stringify = JSON.stringify;
  let serializedChars = 0;
  JSON.stringify = ((value: unknown) => {
    const text = stringify(value);
    serializedChars += text.length;
    return text;
  }) as typeof JSON.stringify;
  let value = "";
  try {
    value = serializeAiData(data);
  } finally {
    JSON.stringify = stringify;
  }
  const timing = await measureScenario(() => {
    serializeAiData(data);
  });
  expect(value).toBe(stringify(data));
  expect(value.length).toBeGreaterThan(1_500_000);
  expect(value.length).toBeLessThanOrEqual(2_000_000);
  expect(serializedChars).toBeLessThan(value.length * 1.01);
  await reportScenario("ai-persist-in-budget", {
    sessions: 12,
    storedChars: value.length,
    serializedChars,
    ...timing,
  });
});
