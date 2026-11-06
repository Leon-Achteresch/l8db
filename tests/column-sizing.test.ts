import { expect, test } from "bun:test";
import { getColumnTypeInfo } from "../src/features/table/data-table/column-type-info";
import { fitClassicColumnSizing } from "../src/features/table/data-table/use-column-sizing";

test("explicit classic widths stay unchanged while unset columns are fitted", () => {
  const rows = [{ id: 1, description: "a fairly long description value" }];
  const typeInfo = new Map(
    ["id", "description"].map((name) => [name, getColumnTypeInfo(name, rows)]),
  );
  const sizing = fitClassicColumnSizing(
    { id: 90 },
    ["id", "description"],
    new Map(),
    typeInfo,
    rows,
  );
  expect(sizing.id).toBe(90);
  expect(sizing.description).toBeGreaterThan(0);
});
