import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import { buildContextMap, MAX_TILES, placeContextMap } from "@/lib/ai/context-map";
import type { AiMessage } from "@/lib/db/ai";
import { measureScenario, reportScenario } from "../scripts/performance-report";

test("context map stays fast and bounded for a 2000-message session with 6000 tool results", async () => {
  const messages: AiMessage[] = Array.from({ length: 2000 }, (_, index) =>
    index % 2 === 0
      ? {
          id: `u${index}`,
          role: "user",
          text: "Frage ".repeat(80),
          context: "Kontext ".repeat(300),
          contextLabels: [`table_${index}`],
        }
      : {
          id: `a${index}`,
          role: "assistant",
          text: "Antwort ".repeat(200),
          rich: Array.from({ length: 6 }, (_, call) => ({
            type: "tool" as const,
            id: `t${index}-${call}`,
            name: `tool_${call % 4}`,
            status: "success",
            sql: "SELECT * FROM orders WHERE id = 1",
            output: "row\t".repeat(2000),
          })),
        },
  );
  const layout = { system: 9000, tools: 60_000, skills: 4000, knowledge: 2000, files: 1000 };
  const summary = { upTo: "a999", count: 1000, text: "Zusammenfassung ".repeat(400) };
  const run = () => {
    const after = buildContextMap({
      layout,
      messages,
      summary,
      prompt: "x",
      measured: 180_000,
      limit: 200_000,
    });
    const before = buildContextMap({
      layout,
      messages,
      summary,
      prompt: "x",
      measured: 180_000 + after.saved,
      limit: 200_000,
      compact: false,
    });
    return [placeContextMap(after, 400, 200), placeContextMap(before, 400, 200)];
  };
  let placed = run();
  Bun.gc(true);
  const heapBefore = heapSize();
  const timing = await measureScenario(() => {
    placed = run();
  }, 40);
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapSize() - heapBefore);
  const tiles = Math.max(...placed.map((entry) => entry.tiles.length));
  expect(timing.medianMs).toBeLessThan(5);
  expect(timing.p95Ms).toBeLessThan(15);
  expect(tiles).toBeLessThanOrEqual(MAX_TILES + 1);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
  await reportScenario("ai-context-map", {
    workload: { messages: messages.length, toolResults: 6000, contextLabels: 1000, runs: 40 },
    ...timing,
    retainedBytes,
    tiles,
    limits: { medianMs: 5, p95Ms: 15, tiles: MAX_TILES + 1, retainedBytes: 4 * 1024 * 1024 },
    environment: {
      os: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ram: totalmem(),
      runtime: Bun.version,
    },
    coverage:
      "Pure map build and squarified layout for before/after compaction; rendered DOM is bounded by the tile cap. No database or model calls; the popover computes it only while open.",
  });
});
