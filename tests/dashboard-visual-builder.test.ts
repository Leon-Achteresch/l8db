import { describe, expect, test } from "bun:test";
import { retainChartMetricSelection } from "../src/features/dashboard/chart-metric-selection";
import {
  assignChartField,
  fieldAggregations,
  updateChartMetric,
} from "../src/features/dashboard/chart-visual-builder-model";
import {
  buildSimpleSql,
  emptyDataset,
  emptySimple,
  joinRef,
  syncJoins,
} from "../src/lib/dashboards";

describe("visual dashboard data assignments", () => {
  test("combines independent measures without changing the original draft", () => {
    const source = { ...emptySimple(), schema: "public", table: "orders" };
    const first = assignChartField(
      source,
      { ref: "total", label: "total", type: "numeric" },
      "metric",
      "total",
    );
    const second = assignChartField(
      first,
      { ref: "customer", label: "customer", type: "text" },
      "metric",
      "customers",
    );
    const sql = buildSimpleSql(second, "postgres");
    expect(source.metrics).toHaveLength(1);
    expect(sql).toContain('SUM("total") AS "m0"');
    expect(sql).toContain('COUNT(DISTINCT "customer") AS "m1"');
    expect(
      assignChartField(
        second,
        { ref: "total", label: "total", type: "numeric" },
        "metric",
        "duplicate",
      ).metrics,
    ).toHaveLength(2);
  });

  test("replaces the initial count with the chosen measure and preserves explicitly added counts", () => {
    const source = { ...emptySimple(), table: "orders" };
    const field = { ref: "total", label: "total", type: "numeric" };
    const first = assignChartField(source, field, "metric", "revenue");
    expect(first.metrics).toEqual([{ id: "revenue", agg: "sum", column: "total", label: "" }]);
    const counted = { ...source, metrics: [{ ...source.metrics[0], label: "Bestellungen" }] };
    const both = assignChartField(counted, field, "metric", "revenue");
    expect(both.metrics.map((metric) => metric.agg)).toEqual(["count", "sum"]);
    expect(source.metrics[0].agg).toBe("count");
  });

  test("date grouping creates a chronological query and enables the shared period filter", () => {
    const source = {
      ...emptySimple(),
      schema: "public",
      table: "orders",
      sort: "metric_desc" as const,
    };
    const date = assignChartField(
      source,
      { ref: "created_at", label: "created_at", type: "timestamp" },
      "dimension",
      "unused",
    );
    const grouped = assignChartField(
      date,
      { ref: "country", label: "country", type: "text" },
      "dimension2",
      "unused",
    );
    const sql = buildSimpleSql(grouped, "postgres", "30d");
    expect(sql).toContain('date_trunc(\'month\', "created_at") AS "dim"');
    expect(sql).toContain('"country" AS "dim2"');
    expect(sql).toContain('WHERE "created_at" >=');
    expect(sql).toContain('ORDER BY "dim" ASC');
  });

  test("does not silently replace an explicitly chosen period field", () => {
    const source = { ...emptySimple(), dateColumn: "paid_at" };
    const next = assignChartField(
      source,
      { ref: "created_at", label: "created_at", type: "date" },
      "dimension",
      "unused",
    );
    expect(next.dateColumn).toBe("paid_at");
  });

  test("keeps nested related-table assignments resolvable in the generated query", () => {
    const source = { ...emptySimple(), schema: "public", table: "orders" };
    const customerJoin = {
      id: "customer",
      schema: "public",
      table: "customers",
      fromColumn: "customer_id",
      toColumn: "id",
    };
    const countryJoin = {
      id: "country",
      parent: "customer",
      schema: "public",
      table: "countries",
      fromColumn: "country_id",
      toColumn: "id",
    };
    const assigned = assignChartField(
      source,
      { ref: joinRef("country", "name"), label: "countries.name", type: "text" },
      "dimension",
      "unused",
    );
    const next = syncJoins(assigned, [countryJoin, customerJoin]);
    const sql = buildSimpleSql(next, "postgres");
    expect(next.joins?.map((join) => join.id)).toEqual(["customer", "country"]);
    expect(sql).toContain('t3."name" AS "dim"');
    expect(sql).toContain('LEFT JOIN "public"."countries" AS t3 ON t3."id" = t2."country_id"');
  });

  test("avoids duplicate category axes when assigning the same field twice", () => {
    const field = { ref: "country", label: "country", type: "text" };
    const source = { ...emptySimple(), dimension2: field.ref };
    const next = assignChartField(source, field, "dimension", "unused");
    expect(next.dimension2).toBeNull();
    expect(assignChartField(next, field, "dimension2", "unused")).toBe(next);
  });

  test("offers numeric calculations only for numeric fields", () => {
    expect(fieldAggregations("numeric")).toContain("avg");
    expect(fieldAggregations("text")).not.toContain("sum");
    expect(fieldAggregations("timestamp")).not.toContain("avg");
  });

  test("refreshes the initial count title when its field or calculation changes", () => {
    const initial = { id: "count", agg: "count" as const, column: null, label: "Anzahl" };
    expect(updateChartMetric(initial, { column: "total" }).label).toBe("");
    expect(updateChartMetric(initial, { agg: "sum", column: "total" }).label).toBe("");
    expect(
      updateChartMetric({ ...initial, label: "Bestellungen" }, { column: "total" }).label,
    ).toBe("Bestellungen");
    expect(initial.label).toBe("Anzahl");
  });
});

describe("chart metric selection", () => {
  test("keeps the chosen measure after an earlier measure is removed", () => {
    const previous = emptyDataset("Umsatz");
    previous.simple.metrics = [
      { id: "orders", agg: "count", column: null, label: "Bestellungen" },
      { id: "revenue", agg: "sum", column: "revenue", label: "" },
    ];
    const next = {
      ...previous,
      simple: { ...previous.simple, metrics: previous.simple.metrics.slice(1) },
    };
    expect(retainChartMetricSelection(previous, next, { metricKeys: ["m1"] })?.metricKeys).toEqual([
      "m0",
    ]);
  });

  test("resets an obsolete selection when a new source replaces its measures", () => {
    const previous = emptyDataset("Alt");
    const next = emptyDataset("Neu");
    expect(
      retainChartMetricSelection(previous, next, { metricKeys: ["m0"], showLegend: false }),
    ).toEqual({ metricKeys: null, showLegend: false });
  });

  test("preserves the explicit order of measures in charts with multiple roles", () => {
    const previous = emptyDataset("Ziele");
    previous.simple.metrics = [
      { id: "actual", agg: "sum", column: "actual", label: "Ist" },
      { id: "target", agg: "sum", column: "target", label: "Ziel" },
    ];
    const next = {
      ...previous,
      simple: { ...previous.simple, metrics: [...previous.simple.metrics].reverse() },
    };
    expect(
      retainChartMetricSelection(previous, next, { metricKeys: ["m0", "m1"] })?.metricKeys,
    ).toEqual(["m1", "m0"]);
  });
});
