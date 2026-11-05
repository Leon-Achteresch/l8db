import { expect, test } from "bun:test";
import { drawBrawl } from "../src/features/dev/transfer-brawl-draw";
import {
  BRAWL_CAP,
  BRAWL_END,
  brawlVariant,
  createBrawl,
  stepBrawl,
} from "../src/features/dev/transfer-brawl-sim";

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
function play(fps: number, scale = 1) {
  const s = createBrawl("staging_db", "prod_shop_eu_west", 7);
  const times: number[] = [];
  let frames = 0;
  while (s.t < BRAWL_END && frames++ < (fps * 100) / scale) {
    const start = performance.now();
    stepBrawl(s, scale / fps);
    times.push(performance.now() - start);
  }
  return { s, times };
}
test("brawl full story has bounded particles and step latency", () => {
  const { s, times } = play(60);
  const median = percentile(times, 0.5);
  const p95 = percentile(times, 0.95);
  console.log(
    `brawl: ${times.length} steps, ${s.real.toFixed(2)} s, peak ${s.peak}, median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms`,
  );
  expect(s.peak).toBeLessThanOrEqual(BRAWL_CAP);
  expect(median).toBeLessThan(0.5);
  expect(p95).toBeLessThan(2);
  expect(s.t).toBe(BRAWL_END);
  expect(s.ko).toBe(true);
  expect(s.stolen).toBe(s.targetName.length);
  expect(s.counterHits).toBe(5);
  expect(s.rollback).toBe(true);
  expect(s.combo).toBe(12);
  expect(s.rows).toBe(128000);
  expect(s.sourceHp).toBeGreaterThan(0);
});
test("brawl preserves the story across frame rates and slow playback", () => {
  for (const fps of [20, 30, 144]) {
    const { s } = play(fps);
    expect(s.ko).toBe(true);
    expect(s.stolen).toBe(s.targetName.length);
    expect(s.event).toBe(22);
  }
  const { s } = play(60, 0.3);
  expect(s.ko).toBe(true);
  expect(s.stolen).toBe(s.targetName.length);
});
test("brawl releases particles at idle and supports disposal by dropping the run", () => {
  const { s } = play(60);
  for (let i = 0; i < 300; i++) stepBrawl(s, 1 / 60);
  expect(s.particles.length).toBe(0);
  expect(s.event).toBe(22);
  const a = createBrawl("a", "b", 7);
  const b = createBrawl("a", "b", 7);
  for (let i = 0; i < 600; i++) {
    stepBrawl(a, 1 / 60);
    stepBrawl(b, 1 / 60);
  }
  expect(a).toEqual(b);
  const run = brawlVariant.create("a", "b", 7);
  run.step(0);
  expect(run.time()).toBe(0);
  expect(run.finished()).toBe(false);
});
test("brawl draw cost stays bounded through a full run", () => {
  let calls = 0;
  let max = 0;
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
      set: () => {
        calls++;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  const s = createBrawl("staging_db", "prod_shop_eu_west", 7);
  const times: number[] = [];
  while (s.t < BRAWL_END) {
    stepBrawl(s, 1 / 60);
    calls = 0;
    const start = performance.now();
    drawBrawl(ctx, s);
    times.push(performance.now() - start);
    max = Math.max(max, calls);
  }
  const median = percentile(times, 0.5);
  console.log(
    `brawl draw: max ${max} calls, median ${median.toFixed(4)} ms, p95 ${percentile(times, 0.95).toFixed(4)} ms`,
  );
  expect(max).toBeLessThan(6000);
  expect(median).toBeLessThan(1);
});
