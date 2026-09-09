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
  overlaps,
  periodStart,
  settle,
} from "../src/lib/dashboards";
import {
  buildFlowSql,
  defaultFlow,
  flowChain,
  flowProblem,
  flowShape,
  insertNode,
  makeRef,
  removeNode,
  updateNodeData,
} from "../src/lib/dataset-flow";

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

describe("flow builder", () => {
  test("kompiliert Quelle → Join → Filter → Gruppierung → Sortierung zu SQL", () => {
    let flow = defaultFlow();
    const source = flow.nodes[0];
    flow = updateNodeData(flow, source.id, { type: "source", schema: "public", table: "orders" });
    flow = insertNode(flow, "join");
    const join = flowChain(flow)[1];
    flow = updateNodeData(flow, join.id, {
      type: "join",
      schema: "public",
      table: "customers",
      joinType: "LEFT",
      fromRef: makeRef(source.id, "customer_id"),
      toColumn: "id",
    });
    flow = insertNode(flow, "filter");
    const filter = flowChain(flow)[2];
    flow = updateNodeData(flow, filter.id, {
      type: "filter",
      conditions: [{ id: "c", ref: makeRef(join.id, "country"), operator: "eq", value: "DE" }],
    });
    flow = insertNode(flow, "aggregate");
    const agg = flowChain(flow)[3];
    flow = updateNodeData(flow, agg.id, {
      type: "aggregate",
      dimension: { ref: makeRef(source.id, "created_at"), bucket: "month" },
      dimension2: null,
      metrics: [{ id: "m", agg: "sum", ref: makeRef(source.id, "amount"), label: "Umsatz" }],
    });
    flow = insertNode(flow, "sort");
    const sort = flowChain(flow)[4];
    flow = updateNodeData(flow, sort.id, { type: "sort", sort: "metric_desc", limit: 12 });
    expect(flowChain(flow).map((n) => n.data.type)).toEqual([
      "source",
      "join",
      "filter",
      "aggregate",
      "sort",
      "output",
    ]);
    const sql = buildFlowSql(flow, "postgres", "all");
    expect(sql).toContain(
      'date_trunc(\'month\', t1."created_at") AS "dim", SUM(t1."amount") AS "m0"',
    );
    expect(sql).toContain('LEFT JOIN "public"."customers" AS t2 ON t2."id" = t1."customer_id"');
    expect(sql).toContain("WHERE t2.\"country\" = 'DE'");
    expect(sql).toContain('ORDER BY "m0" DESC');
    expect(sql).toEndWith("LIMIT 12");
    expect(flowShape(flow).metrics[0]?.label).toBe("Umsatz");
    const removed = removeNode(flow, filter.id);
    expect(flowChain(removed).map((n) => n.data.type)).toEqual([
      "source",
      "join",
      "aggregate",
      "sort",
      "output",
    ]);
    expect(buildFlowSql(removed, "postgres", "all")).not.toContain("WHERE");
    const noJoin = removeNode(flow, join.id);
    const sqlNoJoin = buildFlowSql(noJoin, "postgres", "all");
    expect(sqlNoJoin).not.toContain("t0");
    expect(sqlNoJoin).not.toContain("WHERE");
    expect(sqlNoJoin).toContain('SUM("amount") AS "m0"');
  });

  test("ohne Gruppierung liefert die Ausgabe Rohspalten", () => {
    let flow = defaultFlow();
    const [source, output] = flow.nodes;
    flow = updateNodeData(flow, source.id, { type: "source", schema: "", table: "t" });
    flow = updateNodeData(flow, output.id, {
      type: "output",
      dimension: makeRef(source.id, "plan"),
      values: [makeRef(source.id, "x")],
      dateColumn: null,
    });
    expect(buildFlowSql(flow, "postgres", "all")).toBe(
      'SELECT "plan" AS "dim", "x" AS "m0"\nFROM "t"\nLIMIT 50',
    );
    expect(flowProblem(defaultFlow())).toContain("Quelle");
  });
});
