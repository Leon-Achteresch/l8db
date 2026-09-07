import { describe, expect, test } from "bun:test";

import type { ExplainNode } from "../src/lib/db";
import {
  compareExplainPlans,
  diffPlanNodes,
  planMetrics,
  planToText,
} from "../src/lib/explain-compare";
import type { SavedExplainPlan } from "../src/lib/explain-file";

function node(partial: Record<string, unknown>): ExplainNode {
  return {
    "Node Type": "Seq Scan",
    "Startup Cost": 0,
    "Total Cost": 10,
    "Plan Rows": 100,
    "Plan Width": 8,
    ...partial,
  } as unknown as ExplainNode;
}

function saved(plan: ExplainNode, overrides: Partial<SavedExplainPlan> = {}): SavedExplainPlan {
  return {
    kind: "l8db.explain-plan",
    version: 1,
    capturedAt: "2026-02-03T10:00:00.000Z",
    mode: "EXPLAIN",
    sql: "select * from kunde",
    connectionName: "Prod",
    databaseKind: "postgres",
    database: "shop",
    plan,
    ...overrides,
  };
}

const slow = node({
  "Node Type": "Hash Join",
  "Total Cost": 500,
  "Plan Rows": 1000,
  Plans: [node({ "Relation Name": "kunde" }), node({ "Relation Name": "bestellung" })],
});
const fast = node({
  "Node Type": "Hash Join",
  "Total Cost": 120,
  "Plan Rows": 900,
  Plans: [
    node({ "Node Type": "Index Scan", "Index Name": "kunde_pkey", "Relation Name": "kunde" }),
    node({ "Relation Name": "bestellung" }),
  ],
});

describe("planMetrics", () => {
  test("zählt Knoten rekursiv", () => {
    expect(planMetrics(slow).nodeCount).toBe(3);
  });

  test("fehlende Messwerte bleiben null", () => {
    const metrics = planMetrics(slow);
    expect(metrics.actualTotalTime).toBeNull();
    expect(metrics.actualRows).toBeNull();
    expect(metrics.totalCost).toBe(500);
  });

  test("liest Analyze-Werte", () => {
    const metrics = planMetrics(node({ "Actual Total Time": 4.5, "Actual Rows": 12 }));
    expect(metrics.actualTotalTime).toBe(4.5);
    expect(metrics.actualRows).toBe(12);
  });
});

describe("compareExplainPlans", () => {
  test("Delta und Verhältnis für vorhandene Kennzahlen", () => {
    const result = compareExplainPlans(saved(slow), saved(fast));
    const cost = result.metrics.find((m) => m.key === "totalCost")!;
    expect(cost.left).toBe(500);
    expect(cost.right).toBe(120);
    expect(cost.delta).toBe(-380);
    expect(cost.ratio).toBeCloseTo(0.24);
    expect(cost.measured).toBe(true);
  });

  test("fehlende Messwerte ergeben kein Delta", () => {
    const result = compareExplainPlans(saved(slow), saved(fast));
    const time = result.metrics.find((m) => m.key === "actualTotalTime")!;
    expect(time.measured).toBe(false);
    expect(time.delta).toBeNull();
    expect(time.ratio).toBeNull();
    expect(result.warnings.some((w) => w.includes("nicht als 0"))).toBe(true);
  });

  test("gleiche Pläne mit Analyze sind uneingeschränkt vergleichbar", () => {
    const measured = node({ "Actual Total Time": 3, "Actual Rows": 5 });
    const result = compareExplainPlans(
      saved(measured, { mode: "ANALYZE" }),
      saved(measured, { mode: "ANALYZE" }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.comparable).toBe(true);
  });

  test("abweichendes SQL wird gemeldet", () => {
    const result = compareExplainPlans(saved(slow), saved(slow, { sql: "select 1" }));
    expect(result.comparable).toBe(false);
    expect(result.warnings.some((w) => w.includes("SQL-Anweisungen"))).toBe(true);
  });

  test("Whitespace-Unterschiede im SQL gelten als gleich", () => {
    const result = compareExplainPlans(
      saved(slow),
      saved(slow, { sql: "select  *\nfrom   kunde " }),
    );
    expect(result.warnings.some((w) => w.includes("SQL-Anweisungen"))).toBe(false);
  });

  test("abweichender Datenbankkontext und Modus werden gemeldet", () => {
    const result = compareExplainPlans(
      saved(slow),
      saved(slow, { database: "shop_test", mode: "ANALYZE" }),
    );
    expect(result.warnings.some((w) => w.includes("Datenbankkontext"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Erfassungsmodi"))).toBe(true);
  });
});

describe("diffPlanNodes", () => {
  test("klassifiziert nur links, nur rechts und gleich", () => {
    const rows = diffPlanNodes(slow, fast);
    const byStatus = Object.fromEntries(rows.map((r) => [r.signature, r.status]));
    expect(byStatus["Seq Scan · kunde"]).toBe("only-left");
    expect(byStatus["Index Scan · kunde"]).toBe("only-right");
    expect(byStatus["Seq Scan · bestellung"]).toBe("equal");
    expect(byStatus["Hash Join"]).toBe("equal");
  });

  test("Mengenunterschiede sind changed", () => {
    const left = node({ "Node Type": "Nested Loop", Plans: [node({ "Relation Name": "a" })] });
    const right = node({
      "Node Type": "Nested Loop",
      Plans: [node({ "Relation Name": "a" }), node({ "Relation Name": "a" })],
    });
    const row = diffPlanNodes(left, right).find((r) => r.signature === "Seq Scan · a")!;
    expect(row.status).toBe("changed");
    expect(row.leftCount).toBe(1);
    expect(row.rightCount).toBe(2);
  });

  test("Unterschiede stehen vor Gleichem", () => {
    const rows = diffPlanNodes(slow, fast);
    expect(rows[0].status).not.toBe("equal");
  });
});

describe("planToText", () => {
  test("erzeugt eingerückten Baum", () => {
    const text = planToText(slow);
    expect(text.split("\n")[0]).toContain("Hash Join");
    expect(text).toContain("  -> Seq Scan · kunde");
    expect(text).toContain("cost=0.00..500.00");
  });

  test("zeigt Bedingungen und Messwerte", () => {
    const text = planToText(
      node({ "Index Cond": "id = 1", "Actual Total Time": 1.25, "Actual Rows": 1 }),
    );
    expect(text).toContain("Bedingung: id = 1");
    expect(text).toContain("actual time=1.250");
  });
});
