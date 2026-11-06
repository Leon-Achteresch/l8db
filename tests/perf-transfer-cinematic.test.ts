import { expect, test } from "bun:test";
import { drawScene } from "../src/features/transfer/cinema/transfer-cinema-draw";
import { EPISODE_KINDS } from "../src/features/transfer/cinema/transfer-cinema-episodes";
import {
  createLive,
  feedLive,
  liveFinished,
  stepLive,
} from "../src/features/transfer/cinema/transfer-cinema-live";
import { MAX_PARTICLES, type Scene } from "../src/features/transfer/cinema/transfer-cinema-sim";

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function feed(scene: Scene, total: number, outcome: "success" | "failure") {
  const progress = Math.min(1, scene.clock / total);
  feedLive(scene, {
    progress,
    rows: Math.floor(progress * 25_000_000),
    table: `table_${Math.floor(progress * 400)}`,
    outcome: scene.clock >= total ? outcome : "running",
  });
}

function play(total: number, fps: number, outcome: "success" | "failure" = "success") {
  const scene = createLive("staging_db", "prod_shop_eu_west_backup");
  const durations: number[] = [];
  const episodes = new Set<string>();
  let maxQueue = 0;
  while (!liveFinished(scene) && scene.clock < total + 60) {
    feed(scene, total, outcome);
    const start = performance.now();
    stepLive(scene, 1 / fps);
    durations.push(performance.now() - start);
    if (scene.episode) episodes.add(scene.episode.kind);
    maxQueue = Math.max(maxQueue, scene.queue.length);
  }
  return { scene, durations, episodes, maxQueue };
}

test("transfer cinema stays bounded and fast through a 30 minute transfer", () => {
  const { scene, durations, episodes, maxQueue } = play(1800, 60);
  const median = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  console.log(
    `transfer-cinema 30 min: ${durations.length} steps, peak ${scene.peak} particles, median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms, episodes ${episodes.size}`,
  );
  expect(liveFinished(scene)).toBe(true);
  expect(scene.destroyed).toBe(true);
  expect(scene.stolen).toBe(scene.targetName.length);
  expect(scene.rows).toBe(25_000_000);
  expect(episodes.size).toBe(EPISODE_KINDS.length);
  expect(scene.peak).toBeLessThanOrEqual(MAX_PARTICLES + 40);
  expect(scene.tables.length).toBeLessThanOrEqual(12);
  expect(scene.fired.size).toBeLessThanOrEqual(4);
  expect(maxQueue).toBeLessThanOrEqual(5);
  expect(median).toBeLessThan(0.05);
  expect(p95).toBeLessThan(0.5);
});

test("transfer cinema finishes the full story at low and high frame rates", () => {
  for (const fps of [20, 30, 144]) {
    const { scene } = play(180, fps);
    expect(scene.stolen).toBe(scene.targetName.length);
    expect(scene.destroyed).toBe(true);
    expect(liveFinished(scene)).toBe(true);
  }
});

test("transfer cinema keeps a short transfer on the original timeline", () => {
  const { scene } = play(2, 60);
  expect(scene.destroyed).toBe(true);
  expect(scene.clock).toBeLessThan(21);
});

test("transfer cinema returns the stolen name when the transfer fails", () => {
  const { scene } = play(240, 60, "failure");
  expect(liveFinished(scene)).toBe(true);
  expect(scene.destroyed).toBe(false);
  expect(scene.stolen).toBe(0);
  expect(scene.launched).toBe(0);
});

test("transfer cinema releases its particles after the finale", () => {
  const { scene } = play(60, 60);
  for (let step = 0; step < 60 * 5; step++) stepLive(scene, 1 / 60);
  expect(scene.particles.length).toBe(0);
});

test("transfer cinema draws every frame within a bounded number of canvas calls", () => {
  let calls = 0;
  const gradient = { addColorStop() {} };
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(store, key) {
      if (key in store) return store[key];
      if (key === "createLinearGradient" || key === "createRadialGradient")
        return () => {
          calls++;
          return gradient;
        };
      if (key === "measureText") return () => ({ width: 8 });
      if (key === "setLineDash" || key === "getLineDash") return () => [];
      return () => {
        calls++;
      };
    },
    set(store, key, value) {
      store[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    ellipse() {}
    closePath() {}
  };
  const scene = createLive("staging_db", "prod_shop");
  const durations: number[] = [];
  let maxCalls = 0;
  const total = 300;
  while (!liveFinished(scene) && scene.clock < total + 60) {
    feed(scene, total, "success");
    stepLive(scene, 1 / 30);
    calls = 0;
    const start = performance.now();
    drawScene(ctx, scene);
    durations.push(performance.now() - start);
    maxCalls = Math.max(maxCalls, calls);
  }
  const median = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  console.log(
    `transfer-cinema draw: ${durations.length} frames, max ${maxCalls} calls, median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms`,
  );
  expect(maxCalls).toBeLessThan(6000);
  expect(median).toBeLessThan(1);
});
