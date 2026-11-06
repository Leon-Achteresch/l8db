import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { CATEGORY_COLORS, categoryColorIndex } from "../src/lib/grid-cell-format";

test("100,000 categorical cells keep color selection fast with bounded output", async () => {
  const values = ["ANG", "AKT", "INA", "pending", "shipped", "x".repeat(24)];
  const cells = 100_000;
  const counts = new Uint32Array(CATEGORY_COLORS);
  const timing = await measureScenario(() => {
    counts.fill(0);
    for (let cell = 0; cell < cells; cell++) {
      counts[categoryColorIndex(values[cell % values.length])]++;
    }
  });
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(cells);
  expect(counts.byteLength).toBe(CATEGORY_COLORS * 4);
  expect(timing.p95Ms).toBeLessThan(20);
  await reportScenario("category-colors", {
    ...timing,
    cells,
    maxValueLength: 24,
    outputBytes: counts.byteLength,
    databaseRequests: 0,
    limits: { p95Ms: 20, outputBytes: CATEGORY_COLORS * 4 },
  });
});
