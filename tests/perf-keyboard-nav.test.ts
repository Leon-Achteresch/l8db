import { expect, test } from "bun:test";
import { stepIndex, typeAheadIndex } from "@/lib/keyboard-nav";
import { reportScenario } from "../scripts/performance-report";

function percentiles(durations: number[]) {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(4)),
    p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(4)),
  };
}

test("keyboard nav: list steps and type-ahead stay cheap on large trees", async () => {
  const labels = Array.from({ length: 5_000 }, (_, i) => `table_${String(i).padStart(5, "0")}`);
  labels.push("zz_last");
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  const step: number[] = [];
  let position = 0;
  for (let i = 0; i < 50_000; i++) {
    const start = performance.now();
    position = stepIndex(position, labels.length, keys[i % 4], "vertical") ?? position;
    step.push(performance.now() - start);
  }
  const typeAhead: number[] = [];
  for (let i = 0; i < 2_000; i++) {
    const start = performance.now();
    const hit = typeAheadIndex(labels, i % labels.length, "zz");
    typeAhead.push(performance.now() - start);
    expect(hit).toBe(labels.length - 1);
  }
  const stepTiming = percentiles(step);
  const typeTiming = percentiles(typeAhead);
  expect(stepTiming.p95Ms).toBeLessThan(0.01);
  expect(typeTiming.p95Ms).toBeLessThan(2);
  await reportScenario("keyboard-nav", {
    items: labels.length,
    step: stepTiming,
    typeAheadWorstCase: typeTiming,
  });
});
