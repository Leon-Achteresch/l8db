import { describe, expect, test } from "bun:test";
import { filterConditionText, filterIdentifier, localIsoDate } from "@/lib/filter-bar-format";
import { FILTER_BAR_STYLES, normalizeFilterBarStyle } from "@/lib/filter-bar-style";
import { analyzeQuickFilter } from "@/lib/filter-quick-input";
import { nextRuleColor, ROW_RULE_COLORS } from "@/lib/row-rules";

const columns = ["id", "status", "status_code", "message_id", "created_at", "Order Total"];

describe("analyzeQuickFilter", () => {
  test("parses complete expressions", () => {
    const result = analyzeQuickFilter("status = 'error' AND id > 5", columns, "postgres");
    expect(result.error).toBe("");
    expect(result.parsed?.conditions).toEqual([
      { column: "status", operator: "eq", value: "error", dataType: "text" },
      { column: "id", operator: "gt", value: "5" },
    ]);
    expect(result.suggestions).toEqual([]);
  });

  test("suggests columns while the first word or a word after AND/OR is typed", () => {
    expect(analyzeQuickFilter("sta", columns).suggestions).toEqual(["status", "status_code"]);
    expect(analyzeQuickFilter("id = 1 and mes", columns).suggestions).toEqual(["message_id"]);
    expect(analyzeQuickFilter("id = 1 OR ", columns).suggestions).toEqual(columns);
    expect(analyzeQuickFilter("(cre", columns).suggestions).toEqual(["created_at"]);
    expect(analyzeQuickFilter("status", columns).suggestions).toEqual(["status_code"]);
    expect(analyzeQuickFilter("_id", columns).suggestions).toEqual(["message_id"]);
    expect(analyzeQuickFilter("", columns).suggestions).toEqual([]);
    expect(analyzeQuickFilter("status = sta", columns).suggestions).toEqual([]);
  });

  test("reports why natural language is not a simple filter", () => {
    const result = analyzeQuickFilter("nur fehler von gestern", columns, "postgres");
    expect(result.parsed).toBeNull();
    expect(result.error).toContain("Unbekannte oder mehrdeutige Spalte „nur“");
  });

  test("handles odd input without throwing", () => {
    for (const text of [
      "'",
      "status = 'a",
      "))))",
      "status IN (",
      "-- x",
      "status = 'a'; drop table x",
      "🙂",
      "x".repeat(5000),
    ]) {
      const result = analyzeQuickFilter(text, columns, "postgres");
      expect(result.parsed).toBeNull();
      expect(result.error).not.toBe("");
    }
  });

  test("MongoDB quick filters use the generic parser, Cassandra rejects OR", () => {
    expect(analyzeQuickFilter("status = 'a'", columns, "mongodb").parsed?.conditions).toHaveLength(
      1,
    );
    expect(analyzeQuickFilter("id = 1 OR id = 2", columns, "cassandra").error).toContain(
      "OR wird von Cassandra nicht unterstützt",
    );
  });
});

describe("filter bar helpers", () => {
  test("formats conditions compactly", () => {
    expect(filterConditionText({ id: "", column: "tokens", operator: "gte", value: "5" })).toBe(
      "tokens ≥ 5",
    );
    expect(
      filterConditionText({ id: "", column: "status", operator: "in", value: '["a","b"]' }),
    ).toBe("status in a, b");
    expect(filterConditionText({ id: "", column: "note", operator: "isNull", value: "x" })).toBe(
      "note ist NULL",
    );
  });

  test("quotes identifiers only when needed", () => {
    expect(filterIdentifier("status")).toBe("status");
    expect(filterIdentifier("Order Total")).toBe('"Order Total"');
    expect(filterIdentifier('a"b')).toBe('"a""b"');
  });

  test("uses the local calendar date", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  test("normalizes the stored style", () => {
    expect(FILTER_BAR_STYLES.map((style) => style.value)).toEqual(["classic", "omnibar", "pills"]);
    expect(normalizeFilterBarStyle("pills")).toBe("pills");
    expect(normalizeFilterBarStyle("omnibar")).toBe("omnibar");
    expect(normalizeFilterBarStyle("fancy")).toBe("classic");
    expect(normalizeFilterBarStyle(undefined)).toBe("classic");
  });

  test("picks the next unused rule colour", () => {
    expect(nextRuleColor([])).toBe(ROW_RULE_COLORS[0].value);
    expect(nextRuleColor([{ color: "#EF4444" }])).toBe(ROW_RULE_COLORS[1].value);
    const all = ROW_RULE_COLORS.map((color) => ({ color: color.value }));
    expect(nextRuleColor(all)).toBe(ROW_RULE_COLORS[0].value);
  });
});
