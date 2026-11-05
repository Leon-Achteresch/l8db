import { expect, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import { drawRift, riftVariant } from "../src/features/dev/transfer-rift-draw";
import {
  createRiftScene,
  RIFT_CAP,
  RIFT_DURATION,
  stepRift,
} from "../src/features/dev/transfer-rift-sim";

function percentile(values: number[], p: number) {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * p))];
}
function play(fps: number, speed = 1) {
  const scene = createRiftScene("staging_db", "prod_shop_eu_west", 7);
  const times: number[] = [];
  let steps = 0;
  while (scene.t < RIFT_DURATION && steps++ < 20000) {
    const start = performance.now();
    stepRift(scene, speed / fps);
    times.push(performance.now() - start);
  }
  return { scene, times };
}
test("rift full story stays inside step and retained particle budgets", () => {
  const { scene, times } = play(60);
  const median = percentile(times, 0.5),
    p95 = percentile(times, 0.95);
  console.log(
    `rift: ${platform()} ${arch()}, ${cpus()[0]?.model}, ${(totalmem() / 2 ** 30).toFixed(1)} GiB, Bun ${Bun.version}`,
  );
  console.log(
    `rift: ${times.length} steps, peak ${scene.peak}/${RIFT_CAP} particles, median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms`,
  );
  expect(median).toBeLessThan(0.5);
  expect(p95).toBeLessThan(2);
  expect(scene.peak).toBeLessThanOrEqual(RIFT_CAP);
  expect(scene.t).toBe(RIFT_DURATION);
  expect(scene.stolen).toBe(scene.targetName.length);
  expect(scene.absorbed).toBe(3);
  expect(scene.rows).toBe(1048576);
  expect(scene.event).toBe(9);
  for (let i = 0; i < 300; i++) stepRift(scene, 1 / 60);
  expect(scene.particles.length).toBe(0);
  expect(scene.pool.length).toBe(RIFT_CAP);
});
test("rift tells the entire story at 20, 30, 144 fps and slow motion", () => {
  for (const fps of [20, 30, 144]) {
    const { scene } = play(fps);
    expect(scene.t).toBe(RIFT_DURATION);
    expect(scene.stolen).toBe(scene.targetName.length);
    expect(scene.absorbed).toBe(3);
    expect(scene.event).toBe(9);
    expect(scene.rows).toBe(1048576);
  }
  expect(play(60, 0.3).scene.stolen).toBe("prod_shop_eu_west".length);
  const a = play(60).scene,
    b = play(60).scene;
  expect(a.seed).toBe(b.seed);
  const run = riftVariant.create("a", "b", 7);
  for (let i = 0; i < 1600; i++) run.step(1 / 60);
  expect(run.finished()).toBe(true);
});
test("rift draw has bounded calls and CPU cost across the full timeline", () => {
  let calls = 0,
    max = 0;
  const noop = () => {
    calls++;
  };
  const gradient = { addColorStop: noop };
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "measureText"
          ? () => ({ width: 8 })
          : key === "createLinearGradient" || key === "createRadialGradient"
            ? () => gradient
            : noop,
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  const scene = createRiftScene("staging_db", "prod_shop_eu_west", 7);
  const times: number[] = [];
  while (scene.t < RIFT_DURATION) {
    stepRift(scene, 1 / 60);
    calls = 0;
    const start = performance.now();
    drawRift(ctx, scene);
    times.push(performance.now() - start);
    max = Math.max(max, calls);
  }
  const median = percentile(times, 0.5),
    p95 = percentile(times, 0.95);
  console.log(
    `rift draw: max ${max}/6000 calls, median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms; stub only, no GPU timing`,
  );
  expect(max).toBeLessThan(6000);
  expect(median).toBeLessThan(1);
});
