import { describe, expect, test } from "bun:test";

import {
  buildExpertSql,
  buildSimpleSql,
  calcRef,
  type DashboardVariable,
  emptyDataset,
  emptySimple,
  fieldToken,
  joinRef,
  type SimpleDataset,
  substituteVariables,
  suggestJoins,
  syncJoins,
  variableName,
} from "../src/lib/dashboards";

const artikel = {
  id: "m1",
  schema: "wms",
  table: "artikel",
  fromColumn: "artikel_id",
  toColumn: "id",
  kind: "inner" as const,
  extra: [{ from: "mandant", to: "mandant" }],
  manual: true,
  parent: null,
};

function bestand(patch: Partial<SimpleDataset> = {}): SimpleDataset {
  return { ...emptySimple(), schema: "wms", table: "bestand", joins: [artikel], ...patch };
}

const mandant: DashboardVariable = {
  id: "v1",
  name: "mandant",
  label: "Mandant",
  type: "text",
  defaultValue: "",
};

describe("dashboard studio sql", () => {
  test("manual joins keep their kind and all column pairs", () => {
    const sql = buildSimpleSql(bestand(), "clickhouse");
    expect(sql).toContain(
      'INNER JOIN "wms"."artikel" AS t2 ON t2."id" = t1."artikel_id" AND t2."mandant" = t1."mandant"',
    );
  });

  test("manual joins survive syncJoins without referenced fields", () => {
    expect(syncJoins(bestand(), []).joins?.map((j) => j.id)).toEqual(["m1"]);
  });

  test("calculated fields expand field tokens and aggregate without grouping", () => {
    const reach = {
      id: "c1",
      label: "Reichweite",
      expr: `sum(${fieldToken("menge")}) / nullIf(sum(${fieldToken(joinRef("m1", "entnahme"))}), 0)`,
      aggregate: true,
    };
    const sql = buildSimpleSql(
      bestand({
        calculated: [reach],
        dimension: { column: "lagerbereich", bucket: "none" },
        metrics: [{ id: "x", agg: "sum", column: calcRef("c1"), label: "" }],
      }),
      "clickhouse",
    );
    expect(sql).toContain('(sum(t1."menge") / nullIf(sum(t2."entnahme"), 0)) AS "m0"');
    expect(sql).toContain('GROUP BY t1."lagerbereich"');
    expect(sql).not.toContain("SUM((sum");
  });

  test("filters bound to an empty variable are skipped, filled ones apply", () => {
    const ds = bestand({
      filters: [{ id: "f", column: "mandant", operator: "eq", value: "{{mandant}}" }],
    });
    const scope = { variables: [mandant], values: {} };
    expect(buildSimpleSql(ds, "clickhouse", "all", scope)).not.toContain("WHERE");
    const filled = { variables: [mandant], values: { mandant: "A'1" } };
    expect(buildSimpleSql(ds, "clickhouse", "all", filled)).toContain(`t1."mandant" = 'A''1'`);
  });

  test("expert sql replaces variables with typed literals", () => {
    const days: DashboardVariable = { ...mandant, id: "v2", name: "tage", type: "number" };
    const ds = {
      ...emptyDataset("x"),
      mode: "expert" as const,
      sql: "SELECT * FROM t WHERE m = {{mandant}} AND d < {{ tage }} AND x = {{unknown}}",
    };
    const sql = buildExpertSql(ds, "clickhouse", "all", {
      variables: [mandant, days],
      values: { mandant: "a\\b", tage: "30; DROP" },
    });
    expect(sql).toBe("SELECT * FROM t WHERE m = 'a\\\\b' AND d < NULL AND x = {{unknown}}");
    expect(
      substituteVariables("{{tage}}", { variables: [days], values: { tage: "7" } }, null),
    ).toBe("7");
    expect(
      substituteVariables(
        "SELECT '{{tage}}', 'it''s {{tage}}', \"{{tage}}\", {{tage}}",
        { variables: [days], values: { tage: "7" } },
        null,
      ),
    ).toBe("SELECT '{{tage}}', 'it''s {{tage}}', \"{{tage}}\", 7");
  });

  test("variable names are sql friendly", () => {
    expect(variableName("MHD Restlaufzeit (Tage)")).toBe("mhd_restlaufzeit_tage");
    expect(variableName("1. Größe")).toBe("v_1_grosse");
  });
});

describe("join suggestions", () => {
  test("match key columns to tables without foreign keys", () => {
    const found = suggestJoins(
      { schema: "wms", table: "bestand", columns: ["id", "artikel_id", "lagerplatz_nr", "menge"] },
      [
        { schema: "wms", table: "artikel", columns: ["id", "name", "palettenfaktor"] },
        { schema: "wms", table: "lagerplatz", columns: ["lagerplatz_nr", "bereich", "abc"] },
        { schema: "wms", table: "bewegungen", columns: ["id", "bestand_id", "menge"] },
      ],
    );
    const pairs = found.map((s) => `${s.table}:${s.fromColumn}=${s.toColumn}`);
    expect(pairs).toContain("artikel:artikel_id=id");
    expect(pairs).toContain("lagerplatz:lagerplatz_nr=lagerplatz_nr");
    expect(pairs).toContain("bewegungen:id=bestand_id");
    expect(pairs).not.toContain("bewegungen:menge=menge");
  });
});
