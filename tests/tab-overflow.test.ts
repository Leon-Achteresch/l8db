import { describe, expect, test } from "bun:test";
import { clippedTabKeys } from "../src/lib/tab-overflow";

const tabs = [
  { key: "article", left: 4, width: 100 },
  { key: "invoice", left: 108, width: 180 },
  { key: "query", left: 292, width: 120 },
];

describe("tab overflow", () => {
  test("no menu entries when all objects fit", () => {
    expect(clippedTabKeys(tabs, 0, 416)).toEqual([]);
  });
  test("includes partially clipped and fully hidden objects", () => {
    expect(clippedTabKeys(tabs, 0, 220)).toEqual(["invoice", "query"]);
  });
  test("includes objects on the left after revealing the last tab", () => {
    expect(clippedTabKeys(tabs, 192, 220)).toEqual(["article", "invoice"]);
  });
  test("handles both edges and ignores subpixel rounding", () => {
    expect(clippedTabKeys(tabs, 5, 283)).toEqual(["query"]);
    expect(clippedTabKeys(tabs, 50, 300)).toEqual(["article", "query"]);
  });
  test("handles empty and very narrow viewports", () => {
    expect(clippedTabKeys([], 0, 0)).toEqual([]);
    expect(clippedTabKeys(tabs, 0, 28)).toEqual(["article", "invoice", "query"]);
  });
});
