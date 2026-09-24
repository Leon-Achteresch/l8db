import { describe, expect, test } from "bun:test";

import type { ExplainNode } from "../src/lib/db";
import { normalizeExplainResult } from "../src/lib/explain-normalize";

function kids(node: ExplainNode | null): ExplainNode[] {
  return (node?.Plans ?? []) as ExplainNode[];
}

describe("normalizeExplainResult", () => {
  test("passes Postgres, ClickHouse and Oracle plans through", () => {
    const plan = { "Node Type": "Seq Scan", "Relation Name": "kunde", "Total Cost": 5 };
    expect(normalizeExplainResult([{ Plan: plan, "Planning Time": 0.1 }])).toBe(
      plan as unknown as ExplainNode,
    );
    expect(normalizeExplainResult(null)).toBeNull();
    expect(normalizeExplainResult([])).toBeNull();
  });

  test("maps MySQL FORMAT=JSON query blocks", () => {
    const node = normalizeExplainResult({
      query_block: {
        select_id: 1,
        cost_info: { query_cost: "2015.25" },
        ordering_operation: {
          using_filesort: true,
          nested_loop: [
            {
              table: {
                table_name: "c",
                access_type: "ALL",
                rows_examined_per_scan: 20000,
                rows_produced_per_join: 2000,
                filtered: "10.00",
                cost_info: { read_cost: "10.00", eval_cost: "200.00", prefix_cost: "210.00" },
                attached_condition: "(`c`.`land` = 'DE')",
              },
            },
            {
              table: {
                table_name: "o",
                access_type: "ref",
                key: "idx_kunde",
                used_key_parts: ["kunde_id"],
                ref: ["shop.c.id"],
                rows_examined_per_scan: 3,
                rows_produced_per_join: 6000,
                cost_info: { read_cost: "1500.00", eval_cost: "600.00", prefix_cost: "2310.00" },
              },
            },
          ],
        },
      },
    });
    expect(node?.["Node Type"]).toBe("Query Block #1");
    expect(node?.["Total Cost"]).toBe(2015.25);
    const sort = kids(node)[0];
    expect(sort["Node Type"]).toBe("Sort");
    const loop = kids(sort)[0];
    expect(loop["Node Type"]).toBe("Nested Loop");
    expect(loop["Total Cost"]).toBe(2310);
    const [scan, lookup] = kids(loop);
    expect(scan["Node Type"]).toBe("Full Table Scan");
    expect(scan["Relation Name"]).toBe("c");
    expect(scan["Plan Rows"]).toBe(2000);
    expect(scan["Rows Examined"]).toBe(20000);
    expect(scan["Total Cost"]).toBe(210);
    expect(scan.Filter).toBe("(`c`.`land` = 'DE')");
    expect(lookup["Node Type"]).toBe("Index Lookup");
    expect(lookup["Index Name"]).toBe("idx_kunde");
    expect(lookup["Index Cond"]).toBe("kunde_id = shop.c.id");
  });

  test("parses MySQL EXPLAIN ANALYZE tree output", () => {
    const node = normalizeExplainResult(
      [
        "-> Nested loop inner join  (cost=4.50 rows=10) (actual time=0.045..0.105 rows=10 loops=1)",
        "    -> Filter: (c.land = 'DE')  (cost=1.25 rows=10) (actual time=0.023..0.035 rows=10 loops=1)",
        "        -> Table scan on c  (cost=1.25 rows=10) (actual time=0.020..0.030 rows=100 loops=1)",
        "    -> Single-row index lookup on o using PRIMARY (id=c.id)  (cost=0.26 rows=1) (actual time=844e-6..871e-6 rows=1 loops=10)",
        "    -> Index lookup on x using idx (a=c.a)  (cost=0.26 rows=1) (never executed)",
      ].join("\n"),
    );
    expect(node?.["Node Type"]).toBe("Nested loop inner join");
    expect(node?.["Actual Total Time"]).toBe(0.105);
    const [filter, lookup, never] = kids(node);
    expect(filter["Node Type"]).toBe("Filter");
    expect(filter.Filter).toBe("(c.land = 'DE')");
    const scan = kids(filter)[0];
    expect(scan["Node Type"]).toBe("Table scan");
    expect(scan["Relation Name"]).toBe("c");
    expect(scan["Actual Rows"]).toBe(100);
    expect(lookup["Index Name"]).toBe("PRIMARY");
    expect(lookup["Index Cond"]).toBe("id=c.id");
    expect(lookup["Actual Loops"]).toBe(10);
    expect(lookup["Actual Total Time"]).toBeCloseTo(0.000871);
    expect(lookup["Total Cost"]).toBe(0.26);
    expect(never["Actual Loops"]).toBe(0);
  });

  test("builds the SQLite query plan hierarchy", () => {
    const node = normalizeExplainResult([
      { id: 2, parent: 0, notused: 0, detail: "SCAN c" },
      { id: 4, parent: 0, notused: 0, detail: "SEARCH o USING INDEX idx_kunde (kunde_id=?)" },
      { id: 6, parent: 0, notused: 0, detail: "SEARCH p USING INTEGER PRIMARY KEY (rowid=?)" },
      { id: 9, parent: 0, notused: 0, detail: "USE TEMP B-TREE FOR ORDER BY" },
      { id: 11, parent: 9, notused: 0, detail: "SCAN t USING COVERING INDEX idx_t" },
    ]);
    expect(node?.["Node Type"]).toBe("Query Plan");
    const [scan, search, pk, temp] = kids(node);
    expect(scan["Node Type"]).toBe("Full Scan");
    expect(scan["Relation Name"]).toBe("c");
    expect(search["Node Type"]).toBe("Index Search");
    expect(search["Index Name"]).toBe("idx_kunde");
    expect(search["Index Cond"]).toBe("kunde_id=?");
    expect(pk["Index Name"]).toBe("INTEGER PRIMARY KEY");
    expect(pk["Index Cond"]).toBe("rowid=?");
    expect(temp["Node Type"]).toBe("USE TEMP B-TREE FOR ORDER BY");
    expect(kids(temp)[0]["Node Type"]).toBe("Covering Index Scan");
  });

  test("builds the SQL Server SHOWPLAN_ALL hierarchy", () => {
    const node = normalizeExplainResult([
      {
        StmtText: "SELECT * FROM kunde k JOIN auftrag a ON a.kunde_id = k.id WHERE k.land = 'DE'",
        StmtId: 1,
        NodeId: 1,
        Parent: 0,
        PhysicalOp: null,
        Type: "SELECT",
        TotalSubtreeCost: 1.25,
        EstimateRows: 500,
      },
      {
        StmtText: "  |--Hash Match(Inner Join, HASH:([k].[id])=([a].[kunde_id]))",
        StmtId: 1,
        NodeId: 2,
        Parent: 1,
        PhysicalOp: "Hash Match",
        LogicalOp: "Inner Join",
        Argument: "HASH:([k].[id])=([a].[kunde_id])",
        EstimateRows: 500,
        TotalSubtreeCost: 1.2,
        Type: "PLAN_ROW",
      },
      {
        StmtId: 1,
        NodeId: 3,
        Parent: 2,
        PhysicalOp: "Clustered Index Scan",
        LogicalOp: "Clustered Index Scan",
        Argument:
          "OBJECT:([shop].[dbo].[kunde].[PK_kunde] AS [k]), WHERE:([shop].[dbo].[kunde].[land] as [k].[land]=N'DE')",
        EstimateRows: 20000,
        TotalSubtreeCost: "0.4",
        Type: "PLAN_ROW",
      },
      {
        StmtId: 1,
        NodeId: 4,
        Parent: 2,
        PhysicalOp: "Index Seek",
        LogicalOp: "Index Seek",
        Argument:
          "OBJECT:([shop].[dbo].[auftrag].[idx_kunde] AS [a]), SEEK:([a].[kunde_id]=(1)) ORDERED FORWARD",
        EstimateRows: 3,
        TotalSubtreeCost: 0.1,
        Type: "PLAN_ROW",
      },
    ]);
    expect(node?.["Node Type"]).toBe("SELECT");
    expect(node?.["Total Cost"]).toBe(1.25);
    const join = kids(node)[0];
    expect(join["Node Type"]).toBe("Hash Match (Inner Join)");
    const [scan, seek] = kids(join);
    expect(scan["Node Type"]).toBe("Clustered Index Scan");
    expect(scan["Relation Name"]).toBe("kunde");
    expect(scan["Index Name"]).toBe("PK_kunde");
    expect(scan.Alias).toBe("k");
    expect(scan["Total Cost"]).toBe(0.4);
    expect(String(scan.Filter)).toContain("N'DE'");
    expect(seek["Index Cond"]).toBe("[a].[kunde_id]=(1)");
  });

  test("keeps unknown text plans readable", () => {
    const node = normalizeExplainResult("┌─────┐\n│ SEQ_SCAN │");
    expect(node?.["Node Type"]).toBe("Textplan");
    expect(String(node?.["Plan Text"])).toContain("SEQ_SCAN");
  });
});
