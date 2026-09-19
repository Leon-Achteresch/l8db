import { describe, expect, test } from "bun:test";

import {
  applyOptions,
  buildExpertSql,
  buildSimpleSql,
  chartFits,
  chartNeeds,
  DEFAULT_OPTIONS,
  datasetShape,
  emptyDataset,
  emptySimple,
  joinId,
  joinOptions,
  joinRef,
  overlaps,
  periodStart,
  refLabel,
  settle,
  syncJoins,
} from "../src/lib/dashboards";

const ordersJoin = {
  schema: "public",
  table: "orders",
  fromColumn: "order_id",
  toColumn: "id",
};
const orders = { ...ordersJoin, id: joinId(null, ordersJoin), parent: null };
const customersJoin = {
  schema: "public",
  table: "customers",
  fromColumn: "customer_id",
  toColumn: "id",
};
const customers = {
  ...customersJoin,
  id: joinId(orders.id, customersJoin),
  parent: orders.id,
};

describe("Verknüpfungen", () => {
  test("zwei Schritte über orders zu customers", () => {
    const ds = syncJoins(
      {
        ...emptySimple(),
        schema: "public",
        table: "order_items",
        dimension: { column: joinRef(customers.id, "country"), bucket: "none" },
        metrics: [{ id: "a", agg: "sum", column: "qty", label: "" }],
      },
      [customers, orders],
    );
    expect(ds.joins?.map((j) => j.table)).toEqual(["orders", "customers"]);
    const sql = buildSimpleSql(ds, "postgres");
    expect(sql).toContain('FROM "public"."order_items" AS t1');
    expect(sql).toContain('LEFT JOIN "public"."orders" AS t2 ON t2."id" = t1."order_id"');
    expect(sql).toContain('LEFT JOIN "public"."customers" AS t3 ON t3."id" = t2."customer_id"');
    expect(sql).toContain('t3."country" AS "dim"');
    expect(sql).toContain('SUM(t1."qty") AS "m0"');
    expect(refLabel(joinRef(customers.id, "country"), ds)).toBe("customers.country");
  });

  test("unbenutzte Verknüpfungen fallen weg, benutzte bleiben", () => {
    const base = {
      ...emptySimple(),
      table: "order_items",
      joins: [orders, customers],
      filters: [{ id: "f", column: joinRef(orders.id, "channel"), operator: "eq", value: "web" }],
    };
    expect(syncJoins(base, []).joins?.map((j) => j.table)).toEqual(["orders"]);
    expect(syncJoins({ ...base, filters: [] }, []).joins).toEqual([]);
    expect(
      syncJoins({ ...base, filters: [] }, [], [joinRef(customers.id, "name")]).joins?.length,
    ).toBe(2);
  });

  test("joinOptions: direkt, rückwärts, zweiter Schritt, keine zusammengesetzten Schlüssel", () => {
    const fk = (name: string, from: string, fromColumn: string, to: string, toColumn = "id") => ({
      constraint_name: name,
      from_schema: "public",
      from_table: from,
      from_column: fromColumn,
      to_schema: "public",
      to_table: to,
      to_column: toColumn,
    });
    const fks = [
      fk("items_order", "order_items", "order_id", "orders"),
      fk("orders_customer", "orders", "customer_id", "customers"),
      fk("orders_seller", "orders", "seller_id", "customers"),
      fk("returns_order", "returns", "order_id", "orders"),
      fk("combo", "orders", "a", "pairs", "x"),
      fk("combo", "orders", "b", "pairs", "y"),
    ];
    const fromItems = joinOptions("public", "order_items", [...fks, fks[0]]).map((o) => o.label);
    expect(fromItems).toEqual([
      "orders",
      "orders → customers (über customer_id)",
      "orders → customers (über seller_id)",
    ]);
    const fromOrders = joinOptions("public", "orders", fks);
    expect(fromOrders.map((o) => o.label)).toEqual([
      "customers (über customer_id)",
      "customers (über seller_id)",
      "order_items",
      "returns",
    ]);
    expect(fromOrders[2].join).toMatchObject({
      table: "order_items",
      fromColumn: "id",
      toColumn: "order_id",
    });
  });

  test("ohne Verknüpfung keine Tabellen-Aliase", () => {
    const sql = buildSimpleSql({ ...emptySimple(), table: "orders", joins: [] }, "postgres");
    expect(sql).toContain('FROM "orders"\n');
    expect(sql).not.toContain("t1");
  });
});

describe("buildSimpleSql", () => {
  test("gruppiert nach Monat mit Kennzahl, Join, Filter und Zeitraum", () => {
    const ds = {
      ...emptySimple(),
      schema: "public",
      table: "orders",
      join: { schema: "public", table: "customers", fromColumn: "customer_id", toColumn: "id" },
      dimension: { column: "created_at", bucket: "month" as const },
      metrics: [{ id: "a", agg: "sum" as const, column: "amount", label: "Umsatz" }],
      filters: [{ id: "f", column: "join:country", operator: "eq", value: "DE" }],
      dateColumn: "created_at",
      sort: "metric_desc" as const,
      limit: 10,
    };
    const sql = buildSimpleSql(ds, "postgres", "year");
    expect(sql).toContain('date_trunc(\'month\', t1."created_at") AS "dim"');
    expect(sql).toContain('SUM(t1."amount") AS "m0"');
    expect(sql).toContain('LEFT JOIN "public"."customers" AS t2 ON t2."id" = t1."customer_id"');
    expect(sql).toContain("t2.\"country\" = 'DE'");
    expect(sql).toContain(`t1."created_at" >= '${periodStart("year")}'`);
    expect(sql).toContain("GROUP BY date_trunc('month', t1.\"created_at\")");
    expect(sql).toContain('ORDER BY "m0" DESC');
    expect(sql.endsWith("LIMIT 10")).toBe(true);
  });

  test("mssql nutzt TOP, oracle FETCH FIRST", () => {
    const ds = { ...emptySimple(), table: "t", limit: 5 };
    expect(buildSimpleSql(ds, "mssql")).toStartWith("SELECT TOP 5 COUNT(*)");
    expect(buildSimpleSql(ds, "oracle")).toEndWith("FETCH FIRST 5 ROWS ONLY");
  });

  test("Einzelwert neben Aggregat landet im GROUP BY", () => {
    const ds = {
      ...emptySimple(),
      table: "t",
      dimension: { column: "plan", bucket: "none" as const },
      metrics: [
        { id: "a", agg: "sum" as const, column: "x", label: "" },
        { id: "b", agg: "none" as const, column: "y", label: "" },
      ],
    };
    expect(buildSimpleSql(ds, "postgres")).toContain('GROUP BY "plan", "y"');
  });

  test("ohne Aggregation kein GROUP BY", () => {
    const ds = {
      ...emptySimple(),
      table: "t",
      dimension: { column: "plan", bucket: "none" as const },
      metrics: [{ id: "a", agg: "none" as const, column: "x", label: "" }],
    };
    const sql = buildSimpleSql(ds, "postgres");
    expect(sql).not.toContain("GROUP BY");
    expect(sql).not.toContain("ORDER BY");
  });
});

describe("expert + shape", () => {
  test("Zeitraum wickelt Experten-SQL ein", () => {
    const ds = { ...emptyDataset("x"), mode: "expert" as const, sql: "select * from t;" };
    ds.mapping.dateColumn = "d";
    expect(buildExpertSql(ds, "postgres", "7d")).toStartWith(
      'SELECT * FROM (\nselect * from t\n) AS q WHERE q."d" >=',
    );
    expect(buildExpertSql(ds, "postgres", "all")).toBe("select * from t");
  });

  test("chartFits prüft Dimensionen und Kennzahlen", () => {
    const ds = emptyDataset("x");
    const shape = datasetShape(ds);
    expect(chartFits("kpi", shape)).toBeNull();
    expect(chartFits("area", shape)).toContain("Aufteilung");
    expect(chartFits("scatter", shape)).toContain("Kennzahl");
  });
});

describe("layout", () => {
  test("settle schiebt überlappende Widgets nach unten", () => {
    const a = {
      id: "a",
      chart: "kpi" as const,
      datasetId: null,
      title: "",
      period: "all" as const,
      x: 0,
      y: 0,
      w: 4,
      h: 3,
    };
    const b = { ...a, id: "b" };
    expect(overlaps(a, b)).toBe(true);
    expect(settle(b, [a]).y).toBe(3);
  });
});

describe("widget options", () => {
  test("applyOptions filtert Kennzahlen in Klickreihenfolge und sortiert Zeilen", () => {
    const shape = {
      dimension: "dim",
      dimension2: null,
      metrics: [
        { key: "m0", label: "A" },
        { key: "m1", label: "B" },
      ],
      hasDate: false,
    };
    const rows = [
      { dim: "x", m0: 1, m1: 9 },
      { dim: "y", m0: 5, m1: 2 },
    ];
    const out = applyOptions(shape, rows, {
      ...DEFAULT_OPTIONS,
      metricKeys: ["m1"],
      sortBy: "desc",
    });
    expect(out.shape.metrics.map((m) => m.key)).toEqual(["m1"]);
    expect(out.rows.map((r) => r.dim)).toEqual(["x", "y"]);
    const asc = applyOptions(shape, rows, { ...DEFAULT_OPTIONS, sortBy: "asc" });
    expect(asc.rows.map((r) => r.dim)).toEqual(["x", "y"]);
    const desc = applyOptions(shape, rows, { ...DEFAULT_OPTIONS, sortBy: "desc" });
    expect(desc.rows.map((r) => r.dim)).toEqual(["y", "x"]);
    expect(
      applyOptions(shape, rows, { ...DEFAULT_OPTIONS, metricKeys: ["nope"] }).shape.metrics,
    ).toHaveLength(2);
  });

  test("chartNeeds und chartFits für neue Typen", () => {
    expect(chartNeeds("gauge")).toBe("keine Aufteilung, 2 Kennzahlen");
    expect(chartNeeds("heatmap")).toBe("zwei Aufteilungen, 1 Kennzahl");
    const withDim = {
      dimension: "dim",
      dimension2: null,
      metrics: [
        { key: "m0", label: "" },
        { key: "m1", label: "" },
      ],
      hasDate: false,
    };
    expect(chartFits("gauge", withDim)).toContain("ohne Aufteilung");
    expect(chartFits("gauge", { ...withDim, dimension: null })).toBeNull();
    expect(chartFits("table", { ...withDim, metrics: [] })).toBeNull();
  });
});
