import { describe, expect, test } from "bun:test";
import { columnDragTarget } from "../src/features/table/data-table/column-drag-target";

const widths = [48, 300, 100, 120, 80];
const groups = ["index", "left", "left", "center", "center"];

describe("columnDragTarget", () => {
  test("tauscht erst, wenn die Spaltenmitte die Mitte des Nachbarn überquert", () => {
    expect(columnDragTarget(widths, groups, 1, 390, 0)).toBe(1);
    expect(columnDragTarget(widths, groups, 1, 400, 0)).toBe(2);
    expect(columnDragTarget(widths, groups, 2, 200, 0)).toBe(2);
    expect(columnDragTarget(widths, groups, 2, 190, 0)).toBe(1);
  });

  test("bleibt innerhalb der fixierten bzw. freien Gruppe", () => {
    expect(columnDragTarget(widths, groups, 2, 2000, 0)).toBe(2);
    expect(columnDragTarget(widths, groups, 1, -500, 0)).toBe(1);
    expect(columnDragTarget(widths, groups, 3, -500, 0)).toBe(3);
  });

  test("rechnet die Scrollposition nur bei freien Spalten ein", () => {
    expect(columnDragTarget(widths, groups, 3, 560, 0)).toBe(3);
    expect(columnDragTarget(widths, groups, 3, 560, 60)).toBe(4);
    expect(columnDragTarget(widths, groups, 1, 390, 60)).toBe(1);
  });
});
