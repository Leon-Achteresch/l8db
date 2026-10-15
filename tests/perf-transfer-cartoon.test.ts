import { expect, test } from "bun:test";
import {
  createScene,
  MAX_PARTICLES,
  stepScene,
  TIMELINE,
} from "../src/features/dev/transfer-cartoon-sim";

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function play(fps: number, name = "prod_shop_eu_west") {
  const scene = createScene("staging_db", name);
  const durations: number[] = [];
  while (scene.t < TIMELINE.done) {
    const start = performance.now();
    stepScene(scene, 1 / fps);
    durations.push(performance.now() - start);
  }
  return { scene, durations };
}

test("transfer cartoon keeps particles bounded and steps fast for a full run", () => {
  const { scene, durations } = play(60);
  const median = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  console.log(
    `transfer-cartoon: ${durations.length} steps, peak ${scene.peak} particles, median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`,
  );
  expect(scene.peak).toBeLessThanOrEqual(MAX_PARTICLES + 40);
  expect(median).toBeLessThan(0.5);
  expect(p95).toBeLessThan(2);
  expect(scene.destroyed).toBe(true);
  expect(scene.stolen).toBe(scene.targetName.length);
  expect(scene.particles.filter((p) => p.kind === "smoke").length).toBeLessThan(200);
});

test("transfer cartoon finishes the name theft at low frame rates", () => {
  for (const fps of [20, 30, 144]) {
    const { scene } = play(fps);
    expect(scene.stolen).toBe(scene.targetName.length);
    expect(scene.destroyed).toBe(true);
  }
});

test("transfer cartoon releases its particles after the run", () => {
  const { scene } = play(60);
  for (let step = 0; step < 60 * 5; step++) stepScene(scene, 1 / 60);
  expect(scene.particles.length).toBe(0);
});
