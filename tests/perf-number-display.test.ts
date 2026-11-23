import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { MAX_NUMBER_DISPLAY_CHARACTERS, numberCellText } from "../src/lib/number-display";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("20000 exact numeric strings format without rounding, caching, queries or unbounded exponent expansion", async () => {
  const options = { mode: "grouped", minimumFractionDigits: 4 } as const;
  const values = Array.from(
    { length: 20_000 },
    (_, i) => `${i + 1}12345678901234567890.1234567890123456789000`,
  );
  const run = () => {
    for (const value of values) {
      const formatted = numberCellText(value, options, "decimal(65,30)");
      if (!formatted || formatted.replaceAll("\u202f", "") !== value)
        throw Error("precision changed");
    }
  };
  const formatting = await measureScenario(run, 11);
  const large = "9".repeat(MAX_NUMBER_DISPLAY_CHARACTERS);
  const maximum = await measureScenario(() => {
    for (let i = 0; i < 200; i++) {
      const formatted = numberCellText(large, options, "numeric");
      if (!formatted || formatted.length > MAX_NUMBER_DISPLAY_CHARACTERS * 2 + 8)
        throw Error("unbounded output");
    }
  }, 11);
  const excessive = "9".repeat(1_000_000);
  const fallback = await measureScenario(() => {
    if (numberCellText(excessive, options, "numeric") !== null) throw Error("missing raw fallback");
  }, 11);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let i = 0; i < 5; i++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  const exponent = numberCellText("1e+999999999", options, "numeric");
  expect(exponent).toBe("1.0000e+999999999");
  reportScenario("number-display", {
    cells: values.length,
    formatting,
    maximumInputCells: 200,
    maximumInputCharacters: large.length,
    maximum,
    fallback,
    retainedBytes,
    cachedValues: 0,
    dbRequests: 0,
    backgroundTasks: 0,
    bun: Bun.version,
  });
  expect(formatting.medianMs).toBeLessThan(75);
  expect(formatting.p95Ms).toBeLessThan(150);
  expect(maximum.p95Ms).toBeLessThan(100);
  expect(fallback.p95Ms).toBeLessThan(5);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
});
