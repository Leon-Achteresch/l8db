import { expect, test } from "bun:test";
import { sanitizeAiRich, text } from "@/lib/ai/rich-core";
import { readAiSessions, writeAiSessions } from "@/lib/ai/session-db";
import { type AiSession, aiSessionsLoaded, useAiStore } from "@/lib/ai/store";
import { reportScenario } from "../scripts/performance-report";

const output = "x".repeat(2_000);

function session(index: number, updatedAt = 1_000 + index): AiSession {
  return {
    id: `perf-${index}`,
    title: `Chat ${index}`,
    profileId: "copilot",
    nativeId: null,
    cwd: "/tmp",
    connectionIds: [],
    updatedAt,
    messages: Array.from({ length: 10 }, (_, message) => ({
      id: `m${message}`,
      role: message % 2 ? ("assistant" as const) : ("user" as const),
      text: `Antwort ${index}/${message}`,
      rich: Array.from({ length: 8 }, (_, tool) => ({
        type: "tool" as const,
        id: `t${tool}`,
        name: "l8db_ai_search",
        status: "success",
        output,
      })),
    })),
  };
}

function percentiles(durations: number[]) {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
  };
}

test("AI chats persist per session in IndexedDB with bounded writes", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    },
  });
  const put = IDBObjectStore.prototype.put;
  const written: string[] = [];
  try {
    await aiSessionsLoaded;
    const history = Array.from({ length: 40 }, (_, index) => session(index));
    const historyChars = JSON.stringify(history).length;
    await writeAiSessions(history);
    const total = (await readAiSessions()).length;
    const loadDurations: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      expect(await readAiSessions()).toHaveLength(total);
      loadDurations.push(performance.now() - start);
    }
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      written.push((args[0] as AiSession).id);
      return put.apply(this, args);
    };
    const writeDurations: number[] = [];
    for (let chunk = 0; chunk < 40; chunk++) {
      const start = performance.now();
      await writeAiSessions([session(0, 10_000 + chunk)]);
      writeDurations.push(performance.now() - start);
    }
    written.length = 0;
    const streaming = session(7, Date.now());
    for (let chunk = 0; chunk < 50; chunk++)
      useAiStore.getState().saveSession({
        ...streaming,
        messages: [...streaming.messages, { role: "assistant", text: "x".repeat(chunk * 100) }],
      });
    await Bun.sleep(300);
    const load = percentiles(loadDurations);
    const write = percentiles(writeDurations);
    expect(written).toEqual(["perf-7"]);
    expect(stored.get("l8db.ai") ?? "").not.toContain("Antwort");
    expect(write.p95Ms).toBeLessThan(250);
    expect(load.p95Ms).toBeLessThan(1_500);
    await reportScenario("ai-persist-indexeddb", {
      sessions: 40,
      toolBlocks: 40 * 10 * 8,
      historyChars,
      streamingSaves: 50,
      putsAfterStreaming: written.length,
      load,
      write,
    });
  } finally {
    IDBObjectStore.prototype.put = put;
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}, 60_000);

test("AI tool output redaction stays linear for long unbroken output", async () => {
  const blocks = Array.from({ length: 80 }, (_, index) => ({
    type: "tool",
    id: `t${index}`,
    name: "l8db_ai_search",
    status: "success",
    output: "x".repeat(16_000),
  }));
  const durations: number[] = [];
  for (let run = 0; run < 10; run++) {
    const start = performance.now();
    sanitizeAiRich(blocks);
    durations.push(performance.now() - start);
  }
  const timing = percentiles(durations);
  expect(text("postgres://user:secret@host/db")).toBe("postgres://[redacted]@host/db");
  expect(timing.p95Ms).toBeLessThan(100);
  await reportScenario("ai-rich-redaction", { blocks: 80, outputChars: 16_000, ...timing });
});
