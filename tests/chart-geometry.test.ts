import { expect, test } from "bun:test";
import {
  barPath,
  curvePath,
  niceTicks,
  squarify,
  stackValues,
} from "../src/features/dashboard/charts/svg-geometry";

test("niceTicks deckt den Wertebereich mit runden Schritten ab", () => {
  expect(niceTicks(0, 87)).toEqual([0, 20, 40, 60, 80, 100]);
  expect(niceTicks(-3, 7)).toEqual([-4, -2, 0, 2, 4, 6, 8]);
  expect(niceTicks(0, 0)).toEqual([0, 1]);
  expect(niceTicks(5, 5)).toEqual([0, 1, 2, 3, 4, 5]);
});

test("stackValues stapelt positive und negative Werte getrennt", () => {
  const rows = [
    { a: 2, b: 3 },
    { a: -1, b: 4 },
  ];
  expect(stackValues(rows, ["a", "b"], true)).toEqual([
    [
      [0, 2],
      [0, -1],
    ],
    [
      [2, 5],
      [0, 4],
    ],
  ]);
  expect(stackValues(rows, ["a", "b"], false)[1]).toEqual([
    [0, 3],
    [0, 4],
  ]);
});

test("barPath rundet nur das Datenende ab", () => {
  expect(barPath(10, 20, 100, 40, 4, false)).toBe(
    "M10,100L10,44Q10,40 14,40L26,40Q30,40 30,44L30,100Z",
  );
  expect(barPath(10, 20, 50, 120, 4, true)).toBe(
    "M50,10L116,10Q120,10 120,14L120,26Q120,30 116,30L50,30Z",
  );
});

test("squarify füllt die Fläche proportional ohne Überlappung", () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((value) => ({ value }));
  const tiles = squarify(items, 0, 0, 600, 400);
  expect(tiles).toHaveLength(items.length);
  const total = tiles.reduce((sum, t) => sum + t.width * t.height, 0);
  expect(total).toBeCloseTo(600 * 400, 3);
  for (const t of tiles) {
    expect(t.width * t.height).toBeCloseTo((t.item.value / 24) * 600 * 400, 3);
    expect(t.x + t.width).toBeLessThanOrEqual(600 + 1e-6);
    expect(t.y + t.height).toBeLessThanOrEqual(400 + 1e-6);
  }
});

test("curvePath hält monotone Daten ohne Überschwinger", () => {
  const d = curvePath(
    [
      [0, 10],
      [10, 10],
      [20, 0],
      [30, 0],
    ],
    "monotone",
  );
  const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
  expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(
    curvePath(
      [
        [0, 1],
        [5, 2],
      ],
      "monotone",
    ),
  ).toBe("M0,1L5,2");
});
