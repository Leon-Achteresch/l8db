import { expect, test } from "bun:test";
import { buildCompareApplyPlan } from "../src/lib/compare-apply-plan";
import { EMPTY_COMPARE_SIDE } from "../src/lib/compare-types";

test("derselbe Entwurf kann für Quelle und Ziel getrennt geplant werden", () => {
  const source = {
    ...EMPTY_COMPARE_SIDE,
    connectionId: "source",
    schema: "source",
    objectName: "left_view",
    objectType: "view" as const,
  };
  const target = {
    ...source,
    connectionId: "target",
    schema: "target",
    objectName: "right_view",
  };
  const merged = "SELECT id, name FROM items WHERE active";
  expect(buildCompareApplyPlan("postgres", source, "SELECT id FROM items", merged)).toEqual([
    'CREATE OR REPLACE VIEW "source"."left_view" AS SELECT id, name FROM items WHERE active',
  ]);
  expect(buildCompareApplyPlan("postgres", target, "SELECT id, name FROM items", merged)).toEqual([
    'CREATE OR REPLACE VIEW "target"."right_view" AS SELECT id, name FROM items WHERE active',
  ]);
});
