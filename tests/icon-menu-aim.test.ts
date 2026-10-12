import { expect, test } from "bun:test";
import { isAimingAt } from "../src/components/icon-menu/shared";

const sub = { left: 100, right: 300, top: 50, bottom: 90 } as DOMRectReadOnly;

test("moving diagonally towards the submenu counts as aiming", () => {
  expect(isAimingAt({ x: 110, y: 20 }, { x: 140, y: 30 }, sub)).toBe(true);
  expect(isAimingAt({ x: 110, y: 20 }, { x: 112, y: 40 }, sub)).toBe(true);
});

test("moving along the row or away does not count as aiming", () => {
  expect(isAimingAt({ x: 110, y: 20 }, { x: 150, y: 20 }, sub)).toBe(false);
  expect(isAimingAt({ x: 110, y: 20 }, { x: 80, y: 18 }, sub)).toBe(false);
  expect(isAimingAt({ x: 110, y: 20 }, { x: 110, y: 5 }, sub)).toBe(false);
});

test("inside the submenu always counts", () => {
  expect(isAimingAt({ x: 500, y: 500 }, { x: 200, y: 70 }, sub)).toBe(true);
});
