import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { logTone } from "../src/features/baas/supabase-studio/logs/logs-format";
import { statusLabel } from "../src/features/baas/supabase-studio/supabase-services";
import { layoutTiles } from "../src/features/baas/supabase-studio/tables/table-map-layout";

test("die Tabellenkarte teilt die Fläche lückenlos und proportional auf", () => {
  expect(layoutTiles([], () => 1)).toEqual([]);
  const single = layoutTiles(["a"], () => 5);
  expect(single).toEqual([{ item: "a", x: 0, y: 0, w: 1, h: 1 }]);
  const items = [40, 30, 20, 10, 0];
  const tiles = layoutTiles(items, (value) => value);
  expect(tiles).toHaveLength(items.length);
  const area = tiles.reduce((sum, tile) => sum + tile.w * tile.h, 0);
  expect(area).toBeCloseTo(1, 9);
  for (const tile of tiles) {
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.y).toBeGreaterThanOrEqual(0);
    expect(tile.x + tile.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(tile.y + tile.h).toBeLessThanOrEqual(1 + 1e-9);
  }
  const largest = tiles.find((tile) => tile.item === 40);
  expect((largest?.w ?? 0) * (largest?.h ?? 0)).toBeCloseTo(0.4, 6);
});

test("die Tabellenkarte bleibt bei vielen Tabellen schnell", async () => {
  const items = Array.from({ length: 60 }, (_, index) => ({ rows: (index * 7919) % 100_000 }));
  let tiles = layoutTiles(items, (item) => Math.sqrt(item.rows + 1));
  const timing = await measureScenario(() => {
    for (let run = 0; run < 200; run++)
      tiles = layoutTiles(items, (item) => Math.sqrt(item.rows + 1));
  });
  expect(tiles).toHaveLength(60);
  expect(timing.p95Ms).toBeLessThan(40);
  await reportScenario("supabase-table-map-layout", { ...timing, tiles: 60, runsPerSample: 200 });
});

test("Log-Zeilen werden nach erkennbarem Level eingefärbt", () => {
  expect(logTone(null)).toBeNull();
  expect(logTone('ERROR:  relation "x" does not exist')).toBe("error");
  expect(logTone('{"level":"error","msg":"boom"}')).toBe("error");
  expect(logTone("GET /rest/v1/orders status=503")).toBe("error");
  expect(logTone("WARNING:  there is no transaction in progress")).toBe("warning");
  expect(logTone("POST /auth/v1/token status=401")).toBe("warning");
  expect(logTone("LOG:  checkpoint complete")).toBeNull();
  expect(logTone("connection received: host=10.0.0.5000")).toBeNull();
});

test("Projektstatus wird verständlich beschriftet", () => {
  expect(statusLabel("ACTIVE_HEALTHY")).toBe("Aktiv");
  expect(statusLabel("COMING_UP")).toBe("Startet");
  expect(statusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
});

test("Fehlerwörter in JSON-Feldern färben Info-Logs nicht rot", () => {
  expect(logTone('{"level":"info","msg":"ok","error":null}')).toBeNull();
  expect(logTone("event_message: user error handler registered")).toBeNull();
});
