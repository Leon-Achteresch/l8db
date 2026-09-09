import { expect, test } from "bun:test";
import { GRID_COLS, GRID_GAP, ROW_HEIGHT, rowHeightFor } from "../src/lib/dashboards";

const colWidth = (width: number) => (width - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
const ratio = (width: number) => colWidth(width) / rowHeightFor(width);

test("Kachel-Proportion bleibt beim Verbreitern nahezu gleich", () => {
  const narrow = ratio(900);
  const wide = ratio(1500);
  expect(Math.abs(wide - narrow)).toBeLessThan(0.05);
});

test("Zeilenhöhe bleibt begrenzt und positiv", () => {
  expect(rowHeightFor(0)).toBe(ROW_HEIGHT);
  expect(rowHeightFor(300)).toBe(Math.round(ROW_HEIGHT * 0.7));
  expect(rowHeightFor(6000)).toBe(Math.round(ROW_HEIGHT * 1.5));
});
