import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { assignColumnSlots, columnWindowRange } from "../src/lib/column-window";

test("recycled column slots stay bounded across 10,000 horizontal windows", async () => {
  const columns = 1_000;
  const windows = 10_000;
  let retained = new Map<number, number>();
  let peakSlots = 0;
  let reused = 0;
  const timing = await measureScenario(() => {
    retained = new Map();
    for (let index = 0; index < windows; index++) {
      const startIndex = index % (columns - 7);
      const visible = columnWindowRange(
        { startIndex, endIndex: startIndex + 6, overscan: 2, count: columns },
        [0, columns - 1],
      );
      const slots = assignColumnSlots(visible, retained);
      for (const [column, slot] of slots) {
        if (retained.has(column)) {
          expect(slot).toBe(retained.get(column));
          reused++;
        }
      }
      expect(new Set(slots.values()).size).toBe(slots.size);
      peakSlots = Math.max(peakSlots, slots.size);
      retained = slots;
    }
  });
  expect(peakSlots).toBeLessThanOrEqual(26);
  expect(retained.size).toBeLessThanOrEqual(26);
  expect(reused).toBeGreaterThan(windows);
  expect(timing.p95Ms).toBeLessThan(250);
  await reportScenario("recycled-column-slots", {
    ...timing,
    columns,
    windows,
    peakSlots,
    retainedSlots: retained.size,
    databaseRequests: 0,
    backgroundTasks: 0,
    limits: { p95Ms: 250, retainedSlots: 26 },
  });
});
