import { describe, expect, test } from "bun:test";
import { parseChartFile } from "../src/lib/chart-file";
import {
  buildChartData,
  profileColumns,
  type ResultChartConfig,
  resultChartDataset,
  resultChartFile,
  sanitizeConfig,
  suggestChart,
} from "../src/lib/result-chart";

const base: ResultChartConfig = {
  chart: "column",
  x: "region",
  y: ["amount"],
  series: null,
  agg: "sum",
  sort: "none",
  topN: null,
};

describe("suggestChart", () => {
  test("Kategorie und Zahl ergeben Säulen", () => {
    const rows = [
      { region: "Nord", amount: 3 },
      { region: "Süd", amount: "4.5" },
    ];
    expect(suggestChart(["region", "amount"], rows)).toMatchObject({
      chart: "column",
      x: "region",
      y: ["amount"],
      agg: "none",
    });
  });

  test("Datum und Zahl ergeben Linien, doppelte Tage werden summiert", () => {
    const rows = [
      { day: "2026-01-01", n: 1 },
      { day: "2026-01-01", n: 2 },
      { day: "2026-01-02", n: 3 },
    ];
    expect(suggestChart(["day", "n"], rows)).toMatchObject({
      chart: "line",
      x: "day",
      agg: "sum",
      sort: "x_asc",
    });
  });

  test("zwei Zahlen ergeben Streudiagramm, eine Zeile eine Kennzahl", () => {
    expect(
      suggestChart(
        ["a", "b"],
        [
          { a: 1, b: 2 },
          { a: 3, b: 4 },
        ],
      ).chart,
    ).toBe("scatter");
    expect(suggestChart(["total"], [{ total: 42 }])).toMatchObject({ chart: "kpi", y: ["total"] });
  });

  test("erkennt Spaltenrollen", () => {
    expect(
      profileColumns(["a", "b", "c"], [{ a: "1e3", b: "2026-02-03T10:00:00Z", c: "x" }]),
    ).toEqual({ a: "number", b: "date", c: "text" });
  });
});

describe("buildChartData", () => {
  const rows = [
    { region: "Nord", amount: 1, year: 2025 },
    { region: "Nord", amount: 4, year: 2026 },
    { region: "Süd", amount: 10, year: 2026 },
    { region: "West", amount: null, year: 2026 },
  ];

  test("aggregiert, sortiert und begrenzt", () => {
    const data = buildChartData(rows, { ...base, sort: "value_desc", topN: 2 });
    expect(data.rows).toEqual([
      { dim: "Süd", m0: 10 },
      { dim: "Nord", m0: 5 },
    ]);
    expect(buildChartData(rows, { ...base, agg: "avg" }).rows[0]).toEqual({ dim: "Nord", m0: 2.5 });
    expect(buildChartData(rows, { ...base, agg: "count", y: [] }).rows[0]).toEqual({
      dim: "Nord",
      m0: 2,
    });
    expect(buildChartData(rows, { ...base, agg: "max" }).rows.at(-1)).toEqual({
      dim: "West",
      m0: 0,
    });
  });

  test("Serien bleiben als zweite Aufteilung erhalten", () => {
    const data = buildChartData(rows, { ...base, series: "year" });
    expect(data.shape.dimension2).toBe("dim2");
    expect(data.rows).toContainEqual({ dim: "Nord", dim2: 2026, m0: 4 });
  });

  test("kappt große Ergebnisse mit Hinweis", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ region: `r${i}`, amount: i }));
    const data = buildChartData(many, { ...base, agg: "none" }, 10);
    expect(data.truncated).toBe(true);
    expect(data.rows).toHaveLength(10);
    expect(data.total).toBe(50);
  });

  test("Streudiagramm nutzt X als erste Kennzahl", () => {
    const data = buildChartData([{ a: 1, b: 2, g: "x" }], {
      ...base,
      chart: "scatter",
      x: "a",
      y: ["b"],
      series: "g",
      agg: "none",
    });
    expect(data.shape.dimension).toBe("dim");
    expect(data.rows[0]).toEqual({ dim: "x", m0: 1, m1: 2 });
  });

  test("entfernt unbekannte Spalten aus gespeicherter Konfiguration", () => {
    expect(
      sanitizeConfig({ ...base, y: ["amount", "gone"], series: "gone" }, ["region", "amount"]),
    ).toMatchObject({ y: ["amount"], series: null });
  });
});

describe("Chart-Datei aus Ergebnis", () => {
  test("ohne Aggregation bleibt das SQL unverändert", () => {
    const ds = resultChartDataset({ ...base, agg: "none" }, "select * from t;", "postgres", "X");
    expect(ds.sql).toBe("select * from t");
    expect(ds.mapping).toMatchObject({ dimension: "region", metrics: ["amount"] });
  });

  test("Aggregation wird dialektgerecht um das SQL gelegt", () => {
    const pg = resultChartDataset(
      { ...base, sort: "value_desc", topN: 5 },
      "select * from t",
      "postgres",
      "X",
    );
    expect(pg.sql).toBe(
      'SELECT "region" AS "dim", SUM("amount") AS "m0"\nFROM (\nselect * from t\n) AS l8db_src\nGROUP BY "region"\nORDER BY "m0" DESC\nLIMIT 5',
    );
    const ms = resultChartDataset({ ...base, topN: 3 }, "select 1", "mssql", "X");
    expect(ms.sql.startsWith("SELECT TOP 3 [region] AS [dim]")).toBe(true);
    const ora = resultChartDataset({ ...base, topN: 3 }, "select 1 from dual", "oracle", "X");
    expect(ora.sql).toContain(") l8db_src");
    expect(ora.sql.endsWith("FETCH FIRST 3 ROWS ONLY")).toBe(true);
    expect(pg.mapping).toMatchObject({ dimension: "dim", metrics: ["m0"] });
  });

  test("erzeugt eine gültige l8db-Chart-Datei", () => {
    const file = resultChartFile(base, "select * from t", "postgres", "Umsatz");
    const parsed = parseChartFile(JSON.stringify(file));
    expect(parsed.name).toBe("Umsatz");
    expect(parsed.widget.chart).toBe("column");
    expect(parsed.dataset.mode).toBe("expert");
  });
});
