import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { groupRecentErrors } from "../src/features/baas/convex-studio/overview/convex-overview-insights";

const error = (identifier: string, message: string, timestamp: number) => ({
  identifier,
  udfType: "mutation",
  timestamp,
  message,
  requestId: null,
});

test("Auffälligkeiten fassen gleiche Fehler je Funktion zusammen und sortieren nach Häufigkeit", () => {
  expect(groupRecentErrors([])).toEqual([]);
  const insights = groupRecentErrors([
    error("messages:send", "Uncaught Error: Kein Zugriff\n    at handler (a.ts:1:1)", 10),
    error("users:sync", "Timeout", 50),
    error("messages:send", "Uncaught Error: Kein Zugriff\n    at handler (b.ts:9:2)", 30),
    error("messages:send", "Anderer Fehler", 40),
  ]);
  expect(insights).toEqual([
    {
      identifier: "messages:send",
      udfType: "mutation",
      message: "Uncaught Error: Kein Zugriff",
      count: 2,
      last: 30,
    },
    { identifier: "users:sync", udfType: "mutation", message: "Timeout", count: 1, last: 50 },
    {
      identifier: "messages:send",
      udfType: "mutation",
      message: "Anderer Fehler",
      count: 1,
      last: 40,
    },
  ]);
});

test("Auffälligkeiten bleiben bei vielen Fehlern begrenzt und schnell", async () => {
  const errors = Array.from({ length: 50_000 }, (_, index) =>
    error(`module${index % 400}:fn`, `Fehler ${index % 7}\n    at stack ${index}`, index),
  );
  let insights = groupRecentErrors(errors);
  const timing = await measureScenario(() => {
    insights = groupRecentErrors(errors);
  });
  expect(insights).toHaveLength(20);
  expect(insights[0].count).toBeGreaterThanOrEqual(insights[19].count);
  expect(timing.medianMs).toBeLessThan(60);
  expect(timing.p95Ms).toBeLessThan(150);
  await reportScenario("convex-studio-insights-group", {
    errors: errors.length,
    insights: insights.length,
    medianMs: timing.medianMs,
    p95Ms: timing.p95Ms,
  });
});
