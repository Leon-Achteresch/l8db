import { describe, expect, test } from "bun:test";
import { rowRuleColor } from "@/lib/row-rules";
import type { RowRule } from "@/lib/table-view-state";

const rule = (
  color: string,
  conditions: RowRule["conditions"],
  combinator: RowRule["combinator"] = "AND",
): RowRule => ({ id: color, color, combinator, conditions });

const cond = (column: string, operator: string, value = "") => ({
  id: `${column}-${operator}`,
  column,
  operator,
  value,
});

describe("rowRuleColor", () => {
  const rules = [
    rule("red", [cond("country", "eq", "DE"), cond("total", "gt", "100")]),
    rule("blue", [cond("country", "in", '["AT","CH"]'), cond("note", "isNull")], "OR"),
    rule("green", [cond("name", "contains", "gmbh")]),
  ];

  test("first matching rule wins", () => {
    expect(rowRuleColor({ country: "DE", total: 250 }, rules)).toBe("red");
    expect(rowRuleColor({ country: "DE", total: 99, note: "x", name: "X GmbH" }, rules)).toBe("green");
  });

  test("numeric comparison, OR, lists, null and case-insensitive text", () => {
    expect(rowRuleColor({ country: "DE", total: "1000", note: "x" }, rules)).toBe("red");
    expect(rowRuleColor({ country: "CH", note: "x" }, rules)).toBe("blue");
    expect(rowRuleColor({ country: "US", note: null }, rules)).toBe("blue");
    expect(rowRuleColor({ country: "US", note: "x", name: null }, rules)).toBeUndefined();
  });

  test("ignores incomplete conditions", () => {
    expect(rowRuleColor({ a: 1 }, [rule("x", [cond("a", "eq", "")])])).toBeUndefined();
  });
});
