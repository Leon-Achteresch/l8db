import { describe, expect, test } from "bun:test";
import {
  autoLayout,
  dropZone,
  insertLeaf,
  isSplitTree,
  leafCount,
  namedLayout,
  removeLeaf,
  type SplitTree,
  transposeLayout,
} from "../src/lib/split-layout";

const row = (...children: SplitTree[]): SplitTree => ({ dir: "row", children });
const column = (...children: SplitTree[]): SplitTree => ({ dir: "column", children });

describe("split layout tree", () => {
  test("benannte Layouts entsprechen den Plugin-Layouts", () => {
    expect(namedLayout("columns", 3)).toEqual(row(null, null, null));
    expect(namedLayout("rows", 2)).toEqual(column(null, null));
    expect(namedLayout("topStack", 2)).toEqual(column(null, null));
    expect(namedLayout("leftStack", 2)).toEqual(row(null, null));
    expect(namedLayout("leftStack", 3)).toEqual(row(null, column(null, null)));
    expect(namedLayout("topStack", 4)).toEqual(column(null, row(null, null, null)));
    expect(namedLayout("grid", 3)).toEqual(column(row(null, null), null));
    expect(namedLayout("grid", 4)).toEqual(column(row(null, null), row(null, null)));
    for (const count of [2, 3, 4])
      for (const name of ["columns", "rows", "leftStack", "topStack", "grid"] as const)
        expect(leafCount(namedLayout(name, count))).toBe(count);
  });

  test("Standardlayout folgt Anzahl und Richtung, Plugins dürfen übersteuern", () => {
    expect(autoLayout(2, "horizontal")).toEqual(row(null, null));
    expect(autoLayout(2, "vertical")).toEqual(column(null, null));
    expect(autoLayout(3, "vertical")).toEqual(row(null, column(null, null)));
    expect(autoLayout(3, "horizontal", () => "rows")).toEqual(column(null, null, null));
    expect(autoLayout(4, "horizontal", () => undefined)).toEqual(namedLayout("grid", 4));
  });

  test("Einfügen an einer Kante teilt genau den Zielbereich", () => {
    expect(insertLeaf(null, 0, "right")).toEqual(row(null, null));
    expect(insertLeaf(null, 0, "top")).toEqual(column(null, null));
    expect(insertLeaf(row(null, null), 1, "bottom")).toEqual(row(null, column(null, null)));
    expect(insertLeaf(row(null, null), 0, "bottom")).toEqual(row(column(null, null), null));
    expect(insertLeaf(row(null, null), 0, "left")).toEqual(row(null, null, null));
    expect(insertLeaf(row(null, column(null, null)), 2, "bottom")).toEqual(
      row(null, column(null, null, null)),
    );
    expect(insertLeaf(row(null, column(null, null)), 1, "right")).toEqual(
      row(null, column(row(null, null), null)),
    );
  });

  test("Entfernen vereinfacht den Baum", () => {
    expect(removeLeaf(row(null, column(null, null)), 1)).toEqual(row(null, null));
    expect(removeLeaf(row(null, column(null, null)), 0)).toEqual(column(null, null));
    expect(removeLeaf(column(row(null, null), null), 2)).toEqual(row(null, null));
    expect(removeLeaf(row(null, column(row(null, null), null)), 3)).toEqual(row(null, null, null));
    expect(removeLeaf(row(null, null), 1)).toBeNull();
  });

  test("Drehen tauscht alle Richtungen", () => {
    expect(transposeLayout(row(null, column(null, null)))).toEqual(column(null, row(null, null)));
    expect(transposeLayout(null)).toBeNull();
  });

  test("prüft gespeicherte Bäume", () => {
    expect(isSplitTree(row(null, null))).toBe(true);
    expect(isSplitTree(null)).toBe(true);
    expect(isSplitTree({ dir: "row", children: [null] })).toBe(false);
    expect(isSplitTree({ dir: "diagonal", children: [null, null] })).toBe(false);
    expect(isSplitTree({ dir: "row", children: [null, "x"] })).toBe(false);
  });

  test("Ablagezone: Mitte oder nächste Kante", () => {
    const rect = { left: 0, top: 0, width: 1000, height: 600 };
    expect(dropZone(rect, 500, 300)).toBe("center");
    expect(dropZone(rect, 950, 300)).toBe("right");
    expect(dropZone(rect, 40, 300)).toBe("left");
    expect(dropZone(rect, 500, 20)).toBe("top");
    expect(dropZone(rect, 500, 590)).toBe("bottom");
    expect(dropZone(rect, 950, 300, false)).toBe("center");
  });
});
