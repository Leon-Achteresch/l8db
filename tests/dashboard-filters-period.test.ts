import { describe, expect, test } from "bun:test";

import {
  autoSubtitle,
  buildExpertSql,
  buildSimpleSql,
  compareLabel,
  comparisonRange,
  customPeriod,
  type DashboardVariable,
  emptyDataset,
  emptySimple,
  isPresetPeriod,
  type Period,
  parseCustomPeriod,
  periodLabel,
  periodProgress,
  periodRange,
  type SimpleDataset,
  substituteVariables,
  trendBucket,
  variableList,
  variableLiteral,
} from "../src/lib/dashboards";

const now = new Date(2026, 10, 20, 12);

describe("custom period", () => {
  test("normalizes order and validates real calendar days", () => {
    expect(customPeriod("2026-01-01", "2026-01-31")).toBe("2026-01-01..2026-01-31");
    expect(customPeriod("2026-01-31", "2026-01-01")).toBe("2026-01-01..2026-01-31");
    expect(customPeriod("2026-02-30", "2026-03-01")).toBeNull();
    expect(customPeriod("2026-13-01", "2026-12-01")).toBeNull();
    expect(customPeriod("", "2026-12-01")).toBeNull();
    expect(customPeriod("2024-02-29", "2024-02-29")).toBe("2024-02-29..2024-02-29");
    expect(customPeriod("2025-02-29", "2025-03-01")).toBeNull();
  });

  test("rejects malformed and injected period strings", () => {
    const bad = [
      "2026-01-01..2026-01-31..2026-02-01",
      "2026-01-31..2026-01-01",
      "2026-01-01..2026-01-31' OR 1=1 --",
      "x'..y",
      "constructor",
      "toString",
      "..",
      "2026-1-1..2026-1-31",
    ] as Period[];
    for (const period of bad) {
      expect(parseCustomPeriod(period)).toBeNull();
      expect(periodRange(period, now)).toEqual({ start: null, end: null });
      expect(isPresetPeriod(period)).toBe(false);
    }
    const sql = buildSimpleSql(
      { ...emptySimple(), table: "orders", dateColumn: "created_at" },
      "postgres",
      "2026-01-01..2026-01-31' OR 1=1 --" as Period,
    );
    expect(sql).not.toContain("OR 1=1");
    expect(sql).not.toContain("WHERE");
  });

  test("range is inclusive of the end day and crosses months and years", () => {
    expect(periodRange("2026-01-01..2026-01-31", now)).toEqual({
      start: "2026-01-01",
      end: "2026-02-01",
    });
    expect(periodRange("2025-12-15..2025-12-31", now)).toEqual({
      start: "2025-12-15",
      end: "2026-01-01",
    });
    expect(periodRange("2026-03-05..2026-03-05", now)).toEqual({
      start: "2026-03-05",
      end: "2026-03-06",
    });
  });

  test("filters simple and expert sql with both bounds", () => {
    const simple = buildSimpleSql(
      { ...emptySimple(), table: "orders", dateColumn: "created_at" },
      "postgres",
      "2026-01-01..2026-01-31",
    );
    expect(simple).toContain(`"created_at" >= '2026-01-01'`);
    expect(simple).toContain(`"created_at" < '2026-02-01'`);
    const oracle = buildSimpleSql(
      { ...emptySimple(), table: "ORDERS", dateColumn: "CREATED_AT" },
      "oracle",
      "2026-01-01..2026-01-31",
    );
    expect(oracle).toContain(`>= DATE '2026-01-01'`);
    expect(oracle).toContain(`< DATE '2026-02-01'`);
    const expert = buildExpertSql(
      {
        ...emptyDataset(),
        mode: "expert",
        sql: "select created_at, amount from orders",
        mapping: { ...emptyDataset().mapping, dateColumn: "created_at" },
      },
      "postgres",
      "2026-01-01..2026-01-31",
    );
    expect(expert).toContain(`q."created_at" >= '2026-01-01'`);
    expect(expert).toContain(`q."created_at" < '2026-02-01'`);
  });

  test("comparison covers the previous span of equal length or the prior year", () => {
    expect(comparisonRange("2026-01-01..2026-01-31", "previous", now)).toEqual({
      start: "2025-12-01",
      end: "2026-01-01",
    });
    expect(comparisonRange("2026-01-01..2026-01-31", "year", now)).toEqual({
      start: "2025-01-01",
      end: "2025-02-01",
    });
    expect(comparisonRange("2024-02-29..2024-02-29", "year", now)).toEqual({
      start: "2023-02-28",
      end: "2023-03-01",
    });
    expect(comparisonRange("2026-01-01..2026-01-31", "none", now)).toBeNull();
    expect(comparisonRange("all", "previous", now)).toBeNull();
    expect(comparisonRange("30d", "previous", now)?.start).toBe("2026-09-20");
  });

  test("trend bucket follows the span and labels stay german", () => {
    expect(trendBucket("2026-01-01..2026-01-31")).toBe("day");
    expect(trendBucket("2026-01-01..2026-05-31")).toBe("week");
    expect(trendBucket("2025-01-01..2026-12-31")).toBe("month");
    expect(trendBucket("30d")).toBe("day");
    expect(periodLabel("2026-01-01..2026-01-31")).toBe("01.01.2026 – 31.01.2026");
    expect(periodLabel("2026-03-05..2026-03-05")).toBe("05.03.2026");
    expect(periodLabel("year")).toBe("Dieses Jahr");
    expect(periodLabel("broken" as Period)).toBe("Gesamt");
    expect(compareLabel("2026-01-01..2026-01-31", "previous")).toBe("ggü. Vorperiode");
    expect(compareLabel("2026-01-01..2026-01-31", "year")).toBe("ggü. Vorjahr");
    expect(compareLabel("quarter", "previous")).toBe("ggü. Vorquartal");
    expect(autoSubtitle("day", "2026-01-01..2026-01-31", "")).toBe(
      "Täglich · 01.01.2026 – 31.01.2026",
    );
    expect(periodProgress("2026-01-01..2026-12-31", now)).toBeNull();
  });
});

const kunde: DashboardVariable = {
  id: "v1",
  name: "kunde",
  label: "Kunde",
  type: "select",
  defaultValue: "",
  multiple: true,
};

const art: DashboardVariable = {
  id: "v2",
  name: "art",
  label: "Auftragsart",
  type: "select",
  defaultValue: "",
  column: { schema: "public", table: "orders", column: "plan", dataType: "text" },
  multiple: true,
};

function orders(patch: Partial<SimpleDataset> = {}): SimpleDataset {
  return { ...emptySimple(), schema: "public", table: "orders", ...patch };
}

describe("multi value filters", () => {
  test("list parsing tolerates legacy single values and blanks", () => {
    expect(variableList(kunde, "")).toEqual([]);
    expect(variableList(kunde, "[]")).toEqual([]);
    expect(variableList(kunde, '["A"," ","B","A"]')).toEqual(["A", "B"]);
    expect(variableList(kunde, "Kunde 1")).toEqual(["Kunde 1"]);
    expect(variableList({ ...kunde, multiple: false }, '["A","B"]')).toEqual(['["A","B"]']);
  });

  test("sql tokens expand to quoted lists and escape quotes", () => {
    expect(variableLiteral(kunde, '["A","O\'Brien"]', "postgres")).toBe("'A', 'O''Brien'");
    expect(variableLiteral(kunde, "[]", "postgres")).toBe("NULL");
    const sql = substituteVariables(
      "select * from t where k in ({{kunde}}) and note = '{{kunde}}'",
      { variables: [kunde], values: { kunde: '["A","B"]' } },
      "postgres",
    );
    expect(sql).toBe("select * from t where k in ('A', 'B') and note = '{{kunde}}'");
  });

  test("chart filters coupled to a multi filter become IN / NOT IN", () => {
    const scope = { variables: [kunde], values: { kunde: '["Kunde 1","Kunde 2"]' } };
    const eq = buildSimpleSql(
      orders({ filters: [{ id: "f", column: "name", operator: "eq", value: "{{kunde}}" }] }),
      "postgres",
      "all",
      scope,
    );
    expect(eq).toContain(`"name" IN ('Kunde 1', 'Kunde 2')`);
    const neq = buildSimpleSql(
      orders({ filters: [{ id: "f", column: "name", operator: "neq", value: "{{kunde}}" }] }),
      "postgres",
      "all",
      scope,
    );
    expect(neq).toContain(`"name" NOT IN ('Kunde 1', 'Kunde 2')`);
    const empty = buildSimpleSql(
      orders({ filters: [{ id: "f", column: "name", operator: "eq", value: "{{kunde}}" }] }),
      "postgres",
      "all",
      { variables: [kunde], values: { kunde: "[]" } },
    );
    expect(empty).not.toContain("WHERE");
  });

  test("other operators match any of the selected values", () => {
    const sql = buildSimpleSql(
      orders({
        filters: [{ id: "f", column: "note", operator: "contains", value: "{{kunde}}" }],
      }),
      "postgres",
      "all",
      { variables: [kunde], values: { kunde: '["foo","bar"]' } },
    );
    expect(sql).toContain(
      `WHERE ("note"::text ILIKE '%foo%' ESCAPE '!' OR "note"::text ILIKE '%bar%' ESCAPE '!')`,
    );
    const one = buildSimpleSql(
      orders({
        filters: [{ id: "f", column: "note", operator: "contains", value: "{{kunde}}" }],
      }),
      "postgres",
      "all",
      { variables: [kunde], values: { kunde: '["foo"]' } },
    );
    expect(one).not.toContain(" OR ");
  });

  test("column bound filters apply to base and joined tables only", () => {
    const scope = { variables: [art], values: { art: '["Pro","Team"]' } };
    const base = buildSimpleSql(orders(), "postgres", "all", scope);
    expect(base).toContain(`WHERE "plan" IN ('Pro', 'Team')`);
    const joined = buildSimpleSql(
      {
        ...emptySimple(),
        schema: "public",
        table: "customers",
        joins: [
          {
            id: "j1",
            parent: null,
            schema: "public",
            table: "orders",
            fromColumn: "id",
            toColumn: "customer_id",
            kind: "left",
          },
        ],
      },
      "postgres",
      "all",
      scope,
    );
    expect(joined).toContain(`t2."plan" IN ('Pro', 'Team')`);
    const other = buildSimpleSql(
      { ...emptySimple(), schema: "public", table: "customers" },
      "postgres",
      "all",
      scope,
    );
    expect(other).not.toContain("plan");
    const otherSchema = buildSimpleSql(
      { ...emptySimple(), schema: "archive", table: "orders" },
      "postgres",
      "all",
      scope,
    );
    expect(otherSchema).not.toContain("plan");
    const all = buildSimpleSql(orders(), "postgres", "all", {
      variables: [art],
      values: { art: "" },
    });
    expect(all).not.toContain("WHERE");
  });

  test("column bound filters are not doubled when a chart couples them explicitly", () => {
    const sql = buildSimpleSql(
      orders({ filters: [{ id: "f", column: "plan", operator: "neq", value: "{{art}}" }] }),
      "postgres",
      "all",
      { variables: [art], values: { art: '["Free"]' } },
    );
    expect(sql).toContain(`"plan" NOT IN ('Free')`);
    expect(sql).not.toContain(`"plan" IN ('Free')`);
  });

  test("several dashboard filters combine with AND and with the date range", () => {
    const single: DashboardVariable = {
      id: "v3",
      name: "kanal",
      label: "Kanal",
      type: "select",
      defaultValue: "Web",
      column: { schema: "public", table: "orders", column: "channel" },
    };
    const sql = buildSimpleSql(
      orders({ dateColumn: "created_at" }),
      "postgres",
      "2026-01-01..2026-01-31",
      { variables: [art, single], values: { art: '["Pro"]' } },
    );
    expect(sql).toContain(
      `"plan" IN ('Pro') AND "channel" IN ('Web') AND "created_at" >= '2026-01-01'`,
    );
  });

  test("hostile values stay literals and numbers respect the column type", () => {
    const hostile = buildSimpleSql(orders(), "postgres", "all", {
      variables: [art],
      values: { art: JSON.stringify(["x') OR 1=1 --", "{{art}}"]) },
    });
    expect(hostile).toContain(`IN ('x'') OR 1=1 --', '{{art}}')`);
    const numeric: DashboardVariable = {
      ...art,
      column: { schema: "public", table: "orders", column: "customer_id", dataType: "integer" },
    };
    const sql = buildSimpleSql(orders(), "postgres", "all", {
      variables: [numeric],
      values: { art: '["7","1; drop table orders"]' },
    });
    expect(sql).toContain(`"customer_id" IN (7, '1; drop table orders')`);
  });

  test("oracle splits huge lists into chunks of 1000", () => {
    const values = Array.from({ length: 2500 }, (_, i) => `K${i}`);
    const sql = buildSimpleSql(
      { ...emptySimple(), schema: "APP", table: "ORDERS" },
      "oracle",
      "all",
      {
        variables: [{ ...art, column: { schema: "APP", table: "ORDERS", column: "KUNDE" } }],
        values: { art: JSON.stringify(values) },
      },
    );
    expect(sql.match(/ IN \(/g)?.length).toBe(3);
  });
});
