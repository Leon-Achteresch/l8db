import { beforeAll, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiDesignLab } from "../src/features/dev/ai-design-lab";
import {
  AI_LAB_MESSAGE_LIMIT,
  AI_LAB_SCENES,
  appendAiLabMessage,
} from "../src/features/dev/ai-lab-data";

beforeAll(() => {
  Object.assign(window, {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});

test("AI design lab mounts only the chosen scenario and uses real app components", () => {
  const start = renderToStaticMarkup(createElement(AiDesignLab));
  expect(start).toContain("Nachricht in der KI-Vorschau");
  expect(start).not.toContain("Analyseergebnisse");
  expect(start).not.toContain("MCP-Designvorschau");
  const results = renderToStaticMarkup(createElement(AiDesignLab, { initialScene: "results" }));
  expect(results).toContain("Analyseergebnisse");
  expect(results).toContain("Ergebnisdarstellung");
  expect(results).toContain("Umsatzrückgang untersuchen");
  const approval = renderToStaticMarkup(createElement(AiDesignLab, { initialScene: "approval" }));
  expect(approval).toContain("3 Zeilen ändern");
  expect(approval).not.toContain("<textarea");
  const mcp = renderToStaticMarkup(createElement(AiDesignLab, { initialScene: "mcp" }));
  expect(mcp).toContain("Registriert bedeutet nicht erreichbar");
  expect(mcp).not.toContain("<textarea");
});

test("demo messages keep stable IDs and cap history and input without modifying existing messages", () => {
  const original = [{ id: "first", text: "Vorhandene Nachricht" }];
  let messages = original;
  for (let index = 0; index < 100; index++)
    messages = appendAiLabMessage(messages, `Nachricht ${index}`);
  expect(original).toEqual([{ id: "first", text: "Vorhandene Nachricht" }]);
  expect(messages).toHaveLength(AI_LAB_MESSAGE_LIMIT);
  expect(new Set(messages.map((item) => item.id)).size).toBe(AI_LAB_MESSAGE_LIMIT);
  const next = appendAiLabMessage(messages, "x".repeat(20000));
  expect(next.at(-1)?.text).toHaveLength(2000);
  expect(next[0]).toBe(messages[1]);
  expect(messages.at(-1)?.text).toBe("Nachricht 99");
});

test("AI design lab keeps all scenario renders and a long demo conversation bounded", () => {
  const timings: number[] = [];
  let maxElements = 0;
  for (const scene of AI_LAB_SCENES) {
    renderToStaticMarkup(createElement(AiDesignLab, { initialScene: scene.id }));
    for (let run = 0; run < 8; run++) {
      const started = performance.now();
      const html = renderToStaticMarkup(createElement(AiDesignLab, { initialScene: scene.id }));
      timings.push(performance.now() - started);
      maxElements = Math.max(maxElements, html.match(/<[a-z][a-z0-9]*(?:\s|>)/g)?.length ?? 0);
    }
  }
  const text = "x".repeat(20000);
  let messages = [{ id: "initial", text: "Start" }];
  const started = performance.now();
  for (let run = 0; run < 10000; run++) messages = appendAiLabMessage(messages, text);
  const updateMs = performance.now() - started;
  const sorted = timings.sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  console.log(
    `ai-design-lab: ${timings.length} SSR renders, median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${maxElements} elements; 10000 messages ${updateMs.toFixed(2)} ms, retained ${messages.length} messages / ${messages.reduce((size, item) => size + item.text.length, 0)} chars`,
  );
  expect(median).toBeLessThan(30);
  expect(p95).toBeLessThan(100);
  expect(maxElements).toBeLessThan(1500);
  expect(updateMs).toBeLessThan(250);
  expect(messages).toHaveLength(AI_LAB_MESSAGE_LIMIT);
  expect(messages.reduce((size, item) => size + item.text.length, 0)).toBeLessThanOrEqual(24000);
});
