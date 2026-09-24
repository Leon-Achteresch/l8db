import { describe, expect, test } from "bun:test";

import type { ExplainNode } from "../src/lib/db";
import {
  analyzePlan,
  ancestorsOf,
  heatColor,
  planWarnings,
  selfShare,
} from "../src/lib/explain-analysis";
import { layoutFlame } from "../src/lib/explain-flame";
import {
  buildPlanEdges,
  edgeWidth,
  MAX_EDGE_WIDTH,
  MIN_EDGE_WIDTH,
} from "../src/lib/explain-graph";
import { normalizeExplainResult } from "../src/lib/explain-normalize";

function node(partial: Record<string, unknown>, plans: ExplainNode[] = []): ExplainNode {
  return {
    "Node Type": "Result",
    ...partial,
    ...(plans.length ? { Plans: plans } : {}),
  } as ExplainNode;
}

const analyzed = node(
  {
    "Node Type": "Hash Join",
    "Total Cost": 300,
    "Plan Rows": 100,
    "Actual Total Time": 50,
    "Actual Rows": 100,
    "Actual Loops": 1,
  },
  [
    node({
      "Node Type": "Seq Scan",
      "Relation Name": "auftrag",
      "Total Cost": 200,
      "Plan Rows": 50000,
      "Actual Total Time": 30,
      "Actual Rows": 50000,
      "Actual Loops": 1,
      Filter: "(status = 'offen')",
      "Rows Removed by Filter": 150000,
    }),
    node(
      {
        "Node Type": "Hash",
        "Total Cost": 20,
        "Plan Rows": 10,
        "Actual Total Time": 5,
        "Actual Rows": 1000,
        "Actual Loops": 1,
        "Hash Batches": 4,
      },
      [
        node({
          "Node Type": "Index Scan",
          "Relation Name": "kunde",
          "Index Name": "kunde_pkey",
          "Total Cost": 15,
          "Plan Rows": 10,
          "Actual Total Time": 2,
          "Actual Rows": 1000,
          "Actual Loops": 1,
        }),
      ],
    ),
  ],
);

describe("analyzePlan", () => {
  test("derives self and total time with stable ids", () => {
    const analysis = analyzePlan(analyzed);
    expect(analysis.metric).toBe("time");
    expect(analysis.analyzed).toBe(true);
    expect(analysis.ops.map((op) => op.id)).toEqual(["0", "0.0", "0.1", "0.1.0"]);
    expect(analysis.total).toBe(50);
    expect(analysis.byId.get("0")?.self).toBe(15);
    expect(analysis.byId.get("0.1")?.self).toBe(3);
    expect(analysis.byId.get("0.1.0")?.self).toBe(2);
    expect(selfShare(analysis, analysis.ops[1])).toBeCloseTo(0.6);
    expect(analysis.maxRows).toBe(50000);
    expect(ancestorsOf(analysis, "0.1.0").map((op) => op.id)).toEqual(["0", "0.1"]);
  });

  test("multiplies per-loop time and clamps children larger than the parent", () => {
    const analysis = analyzePlan(
      node({ "Node Type": "Nested Loop", "Actual Total Time": 1, "Actual Loops": 1 }, [
        node({ "Node Type": "Index Scan", "Actual Total Time": 0.5, "Actual Loops": 4 }),
      ]),
    );
    expect(analysis.byId.get("0.0")?.total).toBe(2);
    expect(analysis.root.total).toBe(2);
    expect(analysis.root.self).toBe(0);
  });

  test("falls back to cost and then to node count", () => {
    const costed = analyzePlan(
      node({ "Total Cost": 10 }, [node({ "Total Cost": 4 }), node({ "Total Cost": 3 })]),
    );
    expect(costed.metric).toBe("cost");
    expect(costed.root.self).toBe(3);
    const bare = analyzePlan(node({}, [node({}), node({}, [node({})])]));
    expect(bare.metric).toBe("nodes");
    expect(bare.total).toBe(4);
    expect(bare.analyzed).toBe(false);
  });
});

describe("planWarnings", () => {
  const kinds = (n: ExplainNode) => planWarnings(n).map((w) => w.kind);

  test("flags large full scans with discarding filters", () => {
    expect(kinds((analyzed.Plans ?? [])[0])).toEqual(["full-scan", "index-hint"]);
    expect(kinds(node({ "Node Type": "TABLE ACCESS FULL", "Plan Rows": 200 }))).toEqual([]);
    expect(
      kinds(node({ "Node Type": "Clustered Index Scan", "Plan Rows": 20000, Filter: "x" })),
    ).toEqual(["full-scan", "index-hint"]);
  });

  test("flags misestimates, spills and busy nested loops", () => {
    const hash = (analyzed.Plans ?? [])[1];
    expect(kinds(hash)).toEqual(["misestimate", "spill"]);
    expect(kinds(node({ "Node Type": "Sort", "Sort Method": "external merge" }))).toEqual([
      "spill",
    ]);
    expect(kinds(node({ "Node Type": "SORT ORDER BY", "Sort Space Type": "Disk" }))).toEqual([
      "spill",
    ]);
    expect(
      kinds(
        node({ "Node Type": "Nested Loop" }, [
          node({ "Actual Loops": 1 }),
          node({ "Actual Loops": 5000 }),
        ]),
      ),
    ).toEqual(["nested-loop"]);
    expect(
      kinds(node({ "Node Type": "NESTED LOOPS" }, [node({ "Plan Rows": 2000 }), node({})])),
    ).toEqual(["nested-loop"]);
    expect(kinds(node({ "Plan Rows": 5, "Actual Rows": 0, "Actual Loops": 0 }))).toEqual([]);
  });

  test("reads real Oracle ALLSTATS output", () => {
    const oracle = normalizeExplainResult([
      {
        "Execution Time": 3.2,
        Plan: {
          "Node Type": "SELECT STATEMENT",
          "Total Cost": 7,
          "Actual Loops": 1,
          "Actual Rows": 10,
          "Actual Total Time": 0.525,
          Plans: [
            {
              "Node Type": "HASH GROUP BY",
              "Total Cost": 7,
              "Plan Rows": 10,
              "Actual Loops": 1,
              "Actual Rows": 10,
              "Actual Total Time": 0.502,
              Plans: [
                {
                  "Node Type": "TABLE ACCESS FULL",
                  "Relation Name": "L8_EXPLAIN_T",
                  "Total Cost": 5,
                  "Plan Rows": 4991,
                  Filter: '"T"."V">10',
                  "Actual Loops": 1,
                  "Actual Rows": 4990,
                  "Actual Total Time": 0.233,
                },
              ],
            },
          ],
        },
      },
    ]);
    const analysis = analyzePlan(oracle as ExplainNode);
    expect(analysis.metric).toBe("time");
    expect(analysis.byId.get("0.0")?.self).toBeCloseTo(0.269);
    expect(analysis.byId.get("0.0.0")?.warnings).toEqual([]);
  });
});

describe("layoutFlame", () => {
  test("sizes children proportional to their total", () => {
    const layout = layoutFlame(analyzePlan(analyzed));
    expect(layout.depth).toBe(3);
    const byId = new Map(layout.rects.map((rect) => [rect.id, rect]));
    expect(byId.get("0")).toMatchObject({ x: 0, width: 1, depth: 0 });
    expect(byId.get("0.0")?.width).toBeCloseTo(0.6);
    expect(byId.get("0.1")?.x).toBeCloseTo(0.6);
    expect(byId.get("0.1")?.width).toBeCloseTo(0.1);
    expect(byId.get("0.1.0")?.width).toBeCloseTo(0.04);
  });

  test("zooms into a node and keeps ancestors as full-width breadcrumbs", () => {
    const layout = layoutFlame(analyzePlan(analyzed), "0.1");
    expect(layout.focusId).toBe("0.1");
    expect(layout.rects[0]).toMatchObject({ id: "0", ancestor: true, width: 1 });
    const focus = layout.rects.find((rect) => rect.id === "0.1");
    expect(focus).toMatchObject({ x: 0, width: 1, depth: 1, ancestor: false });
    expect(layout.rects.find((rect) => rect.id === "0.1.0")?.width).toBeCloseTo(0.4);
    expect(layout.rects.some((rect) => rect.id === "0.0")).toBe(false);
    expect(layoutFlame(analyzePlan(analyzed), "missing").focusId).toBe("0");
  });

  test("drops slivers too thin to render", () => {
    const layout = layoutFlame(
      analyzePlan(node({ "Total Cost": 100000 }, [node({ "Total Cost": 1 })])),
    );
    expect(layout.rects.map((rect) => rect.id)).toEqual(["0"]);
  });
});

describe("plan graph", () => {
  test("connects parents to children with row-weighted edges", () => {
    const edges = buildPlanEdges(analyzePlan(analyzed));
    expect(edges.map((edge) => edge.id)).toEqual(["0->0.0", "0->0.1", "0.1->0.1.0"]);
    expect(edges[0].rows).toBe(50000);
    expect(edges[0].width).toBe(MAX_EDGE_WIDTH);
    expect(edges[1].width).toBeLessThan(edges[0].width);
    expect(edgeWidth(null, 10)).toBe(MIN_EDGE_WIDTH);
    expect(edgeWidth(0, 10)).toBe(MIN_EDGE_WIDTH);
  });

  test("heat color intensifies with the self share", () => {
    expect(heatColor(0)).toBe("hsl(50 90% 50% / 0.10)");
    expect(heatColor(1)).toBe("hsl(0 90% 50% / 0.60)");
    expect(heatColor(2)).toBe(heatColor(1));
  });
});
