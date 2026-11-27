import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import { AI_LIMIT_WINDOWS, type AiLimit, mergeAiLimits, parseAiLimits } from "@/lib/ai/limits";
import {
  AI_SPEND_DAYS,
  AI_SPEND_MODELS,
  type AiSpendLog,
  addToSpendLog,
  parseSpendLog,
  spendDay,
  summarizeAiSpend,
} from "@/lib/ai/spend";
import { measureScenario, reportScenario } from "../scripts/performance-report";

test("spend log stays bounded and fast after 20000 requests over 200 days and 40 models", async () => {
  const now = new Date(2026, 10, 24, 12).getTime();
  const requests = 20_000;
  let log: AiSpendLog = {};
  for (let index = 0; index < requests; index++)
    log = addToSpendLog(
      log,
      spendDay(now - (199 - Math.floor(index / 100)) * 86_400_000),
      `provider/model-${index % 40}`,
      { input: 12_000, output: 800, cached: 9000, cost: 0.031, requests: 1, unpriced: 0 },
    );
  let stored = JSON.stringify(log);
  const today = spendDay(now);
  let report = summarizeAiSpend(log, 90, now);
  Bun.gc(true);
  const heapBefore = heapSize();
  const record = await measureScenario(() => {
    stored = JSON.stringify(
      addToSpendLog(parseSpendLog(stored), today, "provider/model-1", {
        input: 12_000,
        output: 800,
        cached: 9000,
        cost: 0.031,
        requests: 1,
        unpriced: 0,
      }),
    );
  }, 60);
  const summarize = await measureScenario(() => {
    report = summarizeAiSpend(parseSpendLog(stored), 90, now);
  }, 60);
  let limits: AiLimit[] = [];
  const limitEvents = await measureScenario(() => {
    for (let index = 0; index < 5000; index++)
      limits = mergeAiLimits(
        limits,
        parseAiLimits({
          rateLimits: {
            limitId: `bucket-${index % 20}`,
            primary: {
              usedPercent: index % 100,
              windowDurationMins: 300,
              resetsAt: now / 1000 + 9000,
            },
            secondary: {
              usedPercent: 12,
              windowDurationMins: 10080,
              resetsAt: now / 1000 + 90_000,
            },
          },
        }),
        now,
      );
  }, 20);
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapSize() - heapBefore);
  const days = Object.keys(parseSpendLog(stored)).length;
  expect(days).toBe(AI_SPEND_DAYS);
  expect(stored.length).toBeLessThan(400_000);
  expect(report.series).toHaveLength(90);
  expect(report.models.length).toBeLessThanOrEqual(41);
  expect(
    Math.max(...Object.values(parseSpendLog(stored)).map((day) => Object.keys(day).length)),
  ).toBeLessThanOrEqual(AI_SPEND_MODELS + 1);
  expect(record.medianMs).toBeLessThan(3);
  expect(record.p95Ms).toBeLessThan(8);
  expect(summarize.medianMs).toBeLessThan(3);
  expect(summarize.p95Ms).toBeLessThan(8);
  expect(limits).toHaveLength(AI_LIMIT_WINDOWS);
  expect(limitEvents.medianMs).toBeLessThan(25);
  expect(limitEvents.p95Ms).toBeLessThan(60);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
  await reportScenario("ai-spend", {
    workload: { requests, days: 200, models: 40, runs: 60 },
    record,
    summarize,
    limitEvents: { events: 5000, buckets: 20, ...limitEvents },
    storedBytes: stored.length,
    retainedBytes,
    limits: {
      medianMs: 3,
      p95Ms: 8,
      storedBytes: 400_000,
      days: AI_SPEND_DAYS,
      modelsPerDay: AI_SPEND_MODELS + 1,
      retainedBytes: 4 * 1024 * 1024,
      limitEventsMedianMs: 25,
      limitEventsP95Ms: 60,
      limitWindows: AI_LIMIT_WINDOWS,
    },
    environment: {
      os: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ram: totalmem(),
      runtime: Bun.version,
    },
    coverage:
      "One record per finished chat request (parse, add, serialize) and one report per opened settings view; no polling. Exchange rates are fetched at most once per 24 hours and only for a non-USD display currency; the network request is not measured here. Limit events are parsed and merged per usage event of a run and kept to a fixed number of windows per profile; nothing polls the providers.",
  });
});
