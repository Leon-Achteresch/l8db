import { expect, test } from "bun:test";
import { buildContextMap, placeContextMap, squarify } from "@/lib/ai/context-map";
import { mergeAiUsage, summarizeAiUsage } from "@/lib/ai/usage";
import type { AiMessage } from "@/lib/db/ai";

const tool = (name: string, output: string) => ({
  type: "tool" as const,
  id: `${name}-${output.length}`,
  name,
  status: "success",
  output,
});

const messages: AiMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "a".repeat(400),
    context: "c".repeat(800),
    contextLabels: ["orders"],
  },
  { id: "a1", role: "assistant", text: "b".repeat(400), rich: [tool("query", "x".repeat(4000))] },
  { id: "u2", role: "user", text: "d".repeat(200) },
  {
    id: "a2",
    role: "assistant",
    text: "e".repeat(200),
    rich: [
      tool("query", "y".repeat(2000)),
      tool("query", "z".repeat(2000)),
      tool("describe", "w".repeat(400)),
    ],
  },
];

const layout = { system: 8000, tools: 12000, skills: 400, knowledge: 0, files: 0 };

test("context map splits system, tools, attachments, chat and grouped tool results", () => {
  const map = buildContextMap({ layout, messages, prompt: "abcd", measured: null, limit: 10_000 });
  const byId = Object.fromEntries(map.tiles.map((tile) => [tile.id, tile]));
  expect(byId.system.tokens).toBe(2000);
  expect(byId.tools.tokens).toBe(3000);
  expect(byId.skills.tokens).toBe(100);
  expect(byId.knowledge).toBeUndefined();
  expect(byId["context:orders"].tokens).toBe(200);
  expect(byId.chat.tokens).toBe(300);
  expect(byId["results:query"].label).toBe("query · 2×");
  expect(byId["results:query"].tokens).toBe(1000);
  expect(byId["results:describe"].tokens).toBe(100);
  expect(byId["results:log"].tokens).toBeGreaterThan(0);
  expect(byId["results:log"].tokens).toBeLessThan(1000);
  expect(byId.draft.tokens).toBe(1);
  expect(map.used).toBe(map.tiles.reduce((sum, tile) => sum + tile.tokens, 0));
});

test("measured context adds agent-internal remainder or scales estimates down", () => {
  const larger = buildContextMap({ layout, messages, prompt: "", measured: 20_000, limit: 50_000 });
  expect(larger.used).toBe(20_000);
  expect(larger.tiles.find((tile) => tile.id === "other")?.tokens).toBeGreaterThan(0);
  expect(larger.tiles.reduce((sum, tile) => sum + tile.tokens, 0)).toBe(20_000);
  const smaller = buildContextMap({ layout, messages, prompt: "", measured: 3_000, limit: 50_000 });
  expect(smaller.tiles.some((tile) => tile.id === "other")).toBe(false);
  expect(Math.abs(smaller.tiles.reduce((sum, tile) => sum + tile.tokens, 0) - 3_000)).toBeLessThan(
    10,
  );
});

test("compaction replaces old turns with the summary and reports savings", () => {
  const summary = { upTo: "a1", count: 2, text: "s".repeat(80) };
  const after = buildContextMap({
    layout,
    messages,
    summary,
    prompt: "",
    measured: null,
    limit: 50_000,
  });
  const before = buildContextMap({
    layout,
    messages,
    summary,
    prompt: "",
    measured: null,
    limit: 50_000,
    compact: false,
  });
  expect(after.compacted).toBe(2);
  expect(after.tiles.find((tile) => tile.id === "summary")?.tokens).toBe(20);
  expect(after.tiles.some((tile) => tile.id === "context:orders")).toBe(false);
  expect(before.tiles.some((tile) => tile.id === "summary")).toBe(false);
  expect(before.used - after.used).toBe(after.saved);
  const stale = buildContextMap({
    layout,
    messages,
    summary: { ...summary, upTo: "gone" },
    prompt: "",
    measured: null,
    limit: 50_000,
  });
  expect(stale.compacted).toBe(0);
});

test("squarify fills the rectangle without overlap and keeps areas proportional", () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((tokens, index) => ({ id: String(index), tokens }));
  const rect = { x: 0, y: 0, w: 600, h: 400 };
  const placed = squarify(items, rect);
  expect(placed).toHaveLength(items.length);
  const area = placed.reduce((sum, tile) => sum + tile.w * tile.h, 0);
  expect(area).toBeCloseTo(rect.w * rect.h, 3);
  for (const tile of placed) {
    expect(tile.w * tile.h).toBeCloseTo((tile.tokens / 24) * rect.w * rect.h, 3);
    expect(tile.x + tile.w).toBeLessThanOrEqual(rect.w + 1e-6);
    expect(tile.y + tile.h).toBeLessThanOrEqual(rect.h + 1e-6);
  }
  for (const a of placed)
    for (const b of placed)
      if (a !== b) {
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
      }
});

test("placement reserves free space proportional to the remaining window", () => {
  const map = buildContextMap({ layout, messages, prompt: "", measured: 25_000, limit: 100_000 });
  const placed = placeContextMap(map, 400, 200);
  expect(placed.free?.x).toBeCloseTo(100, 6);
  expect(Math.max(...placed.tiles.map((tile) => tile.x + tile.w))).toBeCloseTo(100, 6);
  const full = placeContextMap({ ...map, used: 200_000 }, 400, 200);
  expect(full.free).toBeNull();
});

test("layout events persist in usage data and count toward the estimated context", () => {
  let usage = mergeAiUsage(
    {},
    { layout: { system: 4000, skills: 0, knowledge: 0, files: 0, evil: "x" } },
  );
  usage = mergeAiUsage(usage, { layout: { tools: 8000 } });
  expect(usage.layout).toEqual({ system: 4000, skills: 0, knowledge: 0, files: 0, tools: 8000 });
  const summary = summarizeAiUsage(
    usage,
    {
      id: "p",
      provider: "openai",
      binary: "",
      home: "",
      endpoint: "",
      model: "x",
      effort: "",
      mode: "",
    },
    {},
    [{ role: "user", text: "a".repeat(400) }],
  );
  expect(summary.contextEstimated).toBe(true);
  expect(summary.context).toBe(3100);
});
