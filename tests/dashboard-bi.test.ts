import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable } from "../src/features/dashboard/charts/data-table";
import { PivotTable } from "../src/features/dashboard/charts/pivot-table";
import { insertChartFile, makeChartFile } from "../src/lib/chart-file";
import { parseDashboard, serializeDashboard } from "../src/lib/dashboard-file";
import {
  addPage,
  applyCrossFilters,
  blockWidget,
  type CrossFilter,
  combineTotal,
  crossField,
  type Dashboard,
  type Dataset,
  DEFAULT_OPTIONS,
  DETAIL_LIMIT,
  DIM_KEY,
  DIM2_KEY,
  dashboardPages,
  datasetDetailSql,
  datasetMarginSql,
  datasetSql,
  datasetTotalsSql,
  datasetTrendSql,
  emptyDataset,
  interpolateText,
  joinId,
  joinRef,
  mergeTheme,
  movePage,
  ownCondition,
  pageOf,
  removePage,
  sanitizeTheme,
  staleFilter,
  themeCss,
  themeShowsHeader,
  useCrossFilterStore,
  variableLiteral,
  type Widget,
  widgetsOnPage,
} from "../src/lib/dashboards";
import { readsTable, tableDialect } from "../src/lib/dashboards/sql-tables";

function simple(table: string, dimension: string, bucket: "none" | "month" = "none"): Dataset {
  const dataset = emptyDataset(table);
  dataset.simple = {
    ...dataset.simple,
    schema: "public",
    table,
    dimension: { column: dimension, bucket },
    metrics: [{ id: "m", agg: "sum", column: "amount", label: "Umsatz" }],
  };
  return dataset;
}

function expert(sql: string, dimension: string): Dataset {
  return {
    ...emptyDataset("expert"),
    mode: "expert",
    sql,
    mapping: { dimension, dimension2: null, metrics: ["umsatz"], dateColumn: null },
  };
}

function widget(id: string, page?: string, extra: Partial<Widget> = {}): Widget {
  return {
    id,
    chart: "column",
    datasetId: `ds-${id}`,
    title: id,
    period: "all",
    page,
    x: 0,
    y: 0,
    w: 6,
    h: 7,
    ...extra,
  };
}

function filterFrom(dataset: Dataset, value: unknown, widgetId = "source"): CrossFilter {
  const field = crossField(dataset, DIM_KEY);
  if (!field) throw new Error("kein Feld");
  return { widgetId, key: DIM_KEY, field, value, label: "x" };
}

describe("Seiten", () => {
  test("ohne Seiten gibt es genau eine implizite Übersicht", () => {
    expect(dashboardPages({})).toEqual([{ id: "main", name: "Übersicht" }]);
    expect(pageOf({ page: "fehlt" }, dashboardPages({}))).toBe("main");
  });

  test("neue Seiten bekommen eindeutige Kennungen", () => {
    const first = addPage({}, "Vertrieb");
    const second = addPage({ pages: first }, "Vertrieb");
    expect(second.map((page) => page.id)).toEqual(["main", "vertrieb", "vertrieb-2"]);
    expect(addPage({ pages: second }, "Größe & Übersicht").at(-1)?.id).toBe("grosse-ubersicht");
  });

  test("Seite löschen entfernt Inhalte, verwaiste Datensätze und Link-Ziele", () => {
    const pages = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const link = widget("link", "a", {
      datasetId: null,
      block: { type: "link", text: "Zu B", page: "b" },
    });
    const result = removePage(
      {
        pages,
        widgets: [widget("w1", "a"), widget("w2", "b"), link],
        datasets: [
          { ...emptyDataset("1"), id: "ds-w1" },
          { ...emptyDataset("2"), id: "ds-w2" },
        ],
      },
      "b",
    );
    expect(result.pages).toEqual([{ id: "a", name: "A" }]);
    expect(result.widgets.map((w) => w.id)).toEqual(["w1", "link"]);
    expect(result.widgets[1].block?.page).toBeUndefined();
    expect(result.datasets.map((d) => d.id)).toEqual(["ds-w1"]);
  });

  test("die letzte Seite bleibt erhalten und Seiten lassen sich verschieben", () => {
    const pages = [{ id: "a", name: "A" }];
    expect(removePage({ pages, widgets: [], datasets: [] }, "a").pages).toEqual(pages);
    const three = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];
    expect(movePage(three, "c", -1).map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(movePage(three, "a", -1)).toBe(three);
  });

  test("Widgets ohne Seite landen auf der ersten Seite", () => {
    const pages = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const widgets = [widget("x"), widget("y", "b"), widget("z", "weg")];
    expect(widgetsOnPage(widgets, pages, "a").map((w) => w.id)).toEqual(["x", "z"]);
    expect(widgetsOnPage(widgets, pages, "b").map((w) => w.id)).toEqual(["y"]);
  });
});

describe("Theme", () => {
  test("Farben mit CSS-Injektion und entfernte Logos werden abgelehnt", () => {
    expect(() => sanitizeTheme({ primary: "red; background:url(x)" })).toThrow();
    expect(() => sanitizeTheme({ primary: "red" })).toThrow();
    expect(() => sanitizeTheme({ logo: "https://example.com/logo.png" })).toThrow();
    expect(() => sanitizeTheme({ radius: 40 })).toThrow();
    expect(() => sanitizeTheme({ font: "comic" })).toThrow();
  });

  test("gültige Themes werden bereinigt und leere zu null", () => {
    const logo = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    expect(
      sanitizeTheme({ brand: "  ACME  ", primary: "#1d4ed8", logo, unbekannt: 1, palette: [] }),
    ).toEqual({ brand: "ACME", primary: "#1d4ed8", logo });
    expect(sanitizeTheme({ brand: " " })).toBeNull();
    expect(sanitizeTheme(null)).toBeNull();
  });

  test("CSS setzt Variablen, Karten- und Schriftstil und ignoriert ungültige Werte", () => {
    const css = themeCss({
      primary: "#ff0000",
      background: "oklch(0.2 0.02 250)",
      palette: ["#111111", "#222222"],
      font: "serif",
      card: "glass",
      radius: 12,
      density: "compact",
    });
    expect(css).toContain("--dash-accent: #ff0000 !important;");
    expect(css).toContain("--dash-color-2: #222222;");
    expect(css).toContain("--background: oklch(0.2 0.02 250);");
    expect(css).toContain("font-family: Charter");
    expect(css).toContain("backdrop-filter");
    expect(css).toContain("--dash-radius: 12px;");
    expect(css).toContain("--dash-pad: 10px;");
    expect(themeCss({ primary: "red;}body{color:red" })).toBe("");
    expect(themeCss(null)).toBe("");
  });

  test("Kopfzeile erscheint mit Marke oder explizit", () => {
    expect(themeShowsHeader({ brand: "ACME" })).toBe(true);
    expect(themeShowsHeader({ brand: "ACME", header: false })).toBe(false);
    expect(themeShowsHeader({ primary: "#000" })).toBe(false);
  });

  test("Zusammenführen entfernt Schlüssel mit null", () => {
    expect(mergeTheme({ brand: "A", primary: "#000" }, { primary: null, font: "mono" })).toEqual({
      brand: "A",
      font: "mono",
    });
  });
});

describe("Cross-Filter", () => {
  const source = simple("orders", "region");

  test("Charts auf derselben Tabelle werden gefiltert, die Quelle nicht", () => {
    const target = simple("orders", "product");
    const filter = filterFrom(source, "Nord");
    const filtered = applyCrossFilters(target, [filter], "target");
    expect(datasetSql(filtered, "postgres", "all")).toContain(`WHERE "region" = 'Nord'`);
    expect(applyCrossFilters(source, [filter], "source")).toBe(source);
    expect(JSON.stringify(filtered)).toBe(JSON.stringify(target));
  });

  test("Summen-SQL behält die Auswahl", () => {
    const target = simple("orders", "product");
    const filtered = applyCrossFilters(target, [filterFrom(source, "Nord")], "target");
    expect(datasetTotalsSql(filtered, "postgres", "all")).toContain(`"region" = 'Nord'`);
  });

  test("verknüpfte Tabellen werden über den Join-Alias gefiltert", () => {
    const join = {
      schema: "public",
      table: "orders",
      fromColumn: "order_id",
      toColumn: "id",
    };
    const id = joinId(null, join);
    const items = simple("order_items", "sku");
    items.simple.joins = [{ ...join, id, parent: null }];
    const filtered = applyCrossFilters(items, [filterFrom(source, "Süd")], "items");
    expect(datasetSql(filtered, "postgres", "all")).toContain(`t2."region" = 'Süd'`);
    const viaJoin = simple("order_items", joinRef(id, "region"));
    viaJoin.simple.joins = [{ ...join, id, parent: null }];
    expect(crossField(viaJoin, DIM_KEY)).toEqual({
      table: "public.orders",
      column: "region",
      bucket: "none",
    });
  });

  test("fremde Tabellen bleiben unverändert", () => {
    const other = simple("customers", "country");
    expect(applyCrossFilters(other, [filterFrom(source, "Nord")], "other")).toBe(other);
  });

  test("Expertenabfragen mit gleicher Spalte werden umschlossen", () => {
    const target = expert("SELECT region, SUM(x) AS umsatz FROM orders GROUP BY region;", "region");
    const sql = datasetSql(applyCrossFilters(target, [filterFrom(source, 7)], "t"), "mysql", "all");
    expect(sql).toContain(
      "SELECT * FROM (\nSELECT region, SUM(x) AS umsatz FROM orders GROUP BY region\n) AS q WHERE q.`region` = 7",
    );
  });

  test("Zeit-Buckets, NULL und Oracle-Datumswerte", () => {
    const monthly = simple("orders", "created_at", "month");
    const target = simple("orders", "product");
    const field = crossField(monthly, DIM_KEY);
    expect(field?.bucket).toBe("month");
    const sql = datasetSql(
      applyCrossFilters(target, [filterFrom(monthly, "2026-03-01T00:00:00")], "t"),
      "postgres",
      "all",
    );
    expect(sql).toContain(`date_trunc('month', "created_at") = '2026-03-01T00:00:00'`);
    const oracle = datasetSql(
      applyCrossFilters(target, [filterFrom(monthly, "2026-03-01T00:00:00")], "t"),
      "oracle",
      "all",
    );
    expect(oracle).toContain(`TRUNC("created_at", 'MM') = DATE '2026-03-01'`);
    const empty = datasetSql(
      applyCrossFilters(target, [filterFrom(source, null)], "t"),
      "postgres",
      "all",
    );
    expect(empty).toContain(`"region" IS NULL`);
  });

  test("Zeichenketten werden sicher maskiert", () => {
    const target = simple("orders", "product");
    const sql = datasetSql(
      applyCrossFilters(target, [filterFrom(source, "O'Reilly")], "t"),
      "postgres",
      "all",
    );
    expect(sql).toContain(`"region" = 'O''Reilly'`);
  });
});

describe("Drill-through", () => {
  test("einfache Datensätze liefern Detailzeilen mit Limit", () => {
    const dataset = simple("orders", "region");
    const condition = ownCondition(dataset, DIM_KEY, "Nord");
    expect(condition).toEqual({ ref: "region", bucket: "none", value: "Nord" });
    const sql = datasetDetailSql(dataset, condition ? [condition] : [], "postgres", "all");
    expect(sql.startsWith('SELECT *\nFROM "public"."orders"')).toBe(true);
    expect(sql).toContain(`WHERE "region" = 'Nord'`);
    expect(sql).toContain(`LIMIT ${DETAIL_LIMIT}`);
    expect(sql).not.toContain("GROUP BY");
  });

  test("mit Joins nur die Basistabelle und MSSQL mit TOP", () => {
    const join = { schema: "public", table: "orders", fromColumn: "order_id", toColumn: "id" };
    const dataset = simple("order_items", "sku");
    dataset.simple.joins = [{ ...join, id: joinId(null, join), parent: null }];
    expect(datasetDetailSql(dataset, [], "postgres", "all").startsWith("SELECT t1.*")).toBe(true);
    expect(
      datasetDetailSql(dataset, [], "mssql", "all").startsWith(`SELECT TOP ${DETAIL_LIMIT} t1.*`),
    ).toBe(true);
  });

  test("Expertenabfragen werden mit Bedingung und Limit umschlossen", () => {
    const dataset = expert("SELECT region, umsatz FROM v", "region");
    const condition = ownCondition(dataset, DIM_KEY, "Nord");
    const sql = datasetDetailSql(dataset, condition ? [condition] : [], "postgres", "all");
    expect(sql).toContain(`q."region" = 'Nord'`);
    expect(sql.endsWith(`) AS q WHERE q."region" = 'Nord' LIMIT ${DETAIL_LIMIT}`)).toBe(true);
    expect(datasetDetailSql(dataset, [], "oracle", "all")).toContain("FETCH FIRST 200 ROWS ONLY");
  });

  test("zweite Aufteilung wird für Pivot-Zellen gefiltert", () => {
    const dataset = simple("orders", "region");
    dataset.simple.dimension2 = "product";
    expect(ownCondition(dataset, DIM2_KEY, "A")).toEqual({
      ref: "product",
      bucket: "none",
      value: "A",
    });
  });
});

describe("Inhaltsblöcke", () => {
  test("neue Blöcke landen unter dem Inhalt der aktiven Seite", () => {
    const pages = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const block = blockWidget(
      "divider",
      "b",
      [widget("x", "a", { y: 0, h: 20 }), widget("y", "b", { y: 0, h: 4 })],
      pages,
    );
    expect(block).toMatchObject({ page: "b", y: 4, w: 12, h: 1, datasetId: null, chart: "table" });
    expect(block.block?.type).toBe("divider");
  });

  test("Text zeigt aktuelle Filterwerte", () => {
    const variables = [
      { id: "1", name: "region", label: "Region", type: "text" as const, defaultValue: "" },
    ];
    expect(interpolateText("Region: {{region}} {{x}}", variables, { region: "Nord" })).toBe(
      "Region: Nord {{x}}",
    );
    expect(interpolateText("{{ region }}", variables, {})).toBe("alle");
  });
});

describe("Datei", () => {
  test("Seiten und Theme überstehen Speichern und Laden", () => {
    const dashboard: Dashboard = {
      id: "d",
      connectionId: "c",
      database: null,
      name: "Firmenseite",
      datasets: [],
      widgets: [
        widget("t", "start", { datasetId: null, block: { type: "text", text: "# Hallo" } }),
      ],
      pages: [
        { id: "start", name: "Start" },
        { id: "geheim", name: "Intern", hidden: true },
      ],
      theme: { brand: "ACME", primary: "#123456", nav: "sidebar" },
      refreshSec: 0,
      locked: true,
      createdAt: 0,
    };
    const parsed = parseDashboard(serializeDashboard(dashboard));
    expect(parsed.pages).toEqual(dashboard.pages);
    expect(parsed.theme).toEqual(dashboard.theme);
    expect(parsed.widgets[0].block).toEqual({ type: "text", text: "# Hallo" });
  });

  test("ungültige Themes und Seiten aus Dateien werden abgewiesen oder verworfen", () => {
    const base = { name: "x", datasets: [], widgets: [], refreshSec: 0, locked: false };
    expect(() => parseDashboard(JSON.stringify({ ...base, theme: { primary: "x;y" } }))).toThrow();
    const parsed = parseDashboard(
      JSON.stringify({
        ...base,
        pages: [
          { id: "a b", name: "x" },
          { id: "ok", name: "Ok" },
        ],
      }),
    );
    expect(parsed.pages).toEqual([{ id: "ok", name: "Ok" }]);
  });
});

describe("Review-Korrekturen", () => {
  test("Expertenabfragen ohne die Quelltabelle bleiben ungefiltert", () => {
    const source = simple("customers", "status");
    const target = expert(
      "SELECT status, COUNT(*) AS umsatz FROM orders GROUP BY status",
      "status",
    );
    expect(applyCrossFilters(target, [filterFrom(source, "aktiv")], "t")).toBe(target);
    const related = expert("SELECT c.status, 1 AS umsatz FROM public.customers c", "status");
    expect(applyCrossFilters(related, [filterFrom(source, "aktiv")], "t")).not.toBe(related);
  });

  test("Oracle vergleicht ungebuckelte Werte als Text", () => {
    const source = simple("orders", "code");
    const target = simple("orders", "product");
    const sql = datasetSql(
      applyCrossFilters(target, [filterFrom(source, "2024-03-01")], "t"),
      "oracle",
      "all",
    );
    expect(sql).toContain(`"code" = '2024-03-01'`);
  });

  test("Pivot-Zellen setzen beide Filter gemeinsam", () => {
    const store = useCrossFilterStore.getState();
    const source = simple("orders", "region");
    source.simple.dimension2 = "month";
    const row = crossField(source, DIM_KEY);
    const column = crossField(source, DIM2_KEY);
    if (!row || !column) throw new Error("Feld fehlt");
    const cell = (r: string, c: string): CrossFilter[] => [
      { widgetId: "p", key: DIM_KEY, field: row, value: r, label: r },
      { widgetId: "p", key: DIM2_KEY, field: column, value: c, label: c },
    ];
    store.clear("review");
    store.select("review", cell("A", "Jan"));
    store.select("review", cell("A", "Feb"));
    expect(useCrossFilterStore.getState().filters.review.map((f) => f.value)).toEqual(["A", "Feb"]);
    store.select("review", cell("A", "Feb"));
    expect(useCrossFilterStore.getState().filters.review).toEqual([]);
  });

  test("Farbfunktionen müssen klein geschrieben sein wie im Rust-Backend", () => {
    expect(() => sanitizeTheme({ primary: "RGB(1,2,3)" })).toThrow();
    expect(sanitizeTheme({ primary: "rgb(1, 2, 3)" })).toEqual({ primary: "rgb(1, 2, 3)" });
  });

  test("Charts aus der Bibliothek landen auf der aktiven Seite", () => {
    const dashboard: Dashboard = {
      id: "d",
      connectionId: "c",
      database: null,
      name: "x",
      datasets: [],
      widgets: [widget("a", "eins", { y: 0, h: 30 }), widget("b", "zwei", { y: 0, h: 5 })],
      pages: [
        { id: "eins", name: "Eins" },
        { id: "zwei", name: "Zwei" },
      ],
      refreshSec: 0,
      locked: false,
      createdAt: 0,
    };
    const file = makeChartFile(widget("src", "weg"), emptyDataset("Kopie"), "Kopie");
    const inserted = insertChartFile(dashboard, file, "zwei");
    expect(inserted.widget.page).toBe("zwei");
    expect(inserted.widget.y).toBe(5);
  });
});

describe("Exakte Summen", () => {
  test("Pivot-Ränder und Gesamtwert kommen aus eigenen gruppierten Abfragen", () => {
    const dataset = simple("orders", "region");
    dataset.simple.dimension2 = "product";
    dataset.simple.metrics = [{ id: "m", agg: "avg", column: "amount", label: "Schnitt" }];
    const rows = datasetMarginSql(dataset, "rows", ["Nord", "Süd", null], "postgres", "all");
    const columns = datasetMarginSql(dataset, "columns", ["A"], "postgres", "all");
    const grand = datasetTotalsSql(dataset, "postgres", "all");
    expect(rows).toContain(`"region" AS "dim"`);
    expect(rows).not.toContain("dim2");
    expect(columns).toContain(`"product" AS "dim"`);
    expect(grand).toContain(`AVG("amount") AS "m0"`);
    expect(grand).not.toContain("GROUP BY");
    expect(new Set([datasetSql(dataset, "postgres", "all"), rows, columns, grand]).size).toBe(4);
    expect(rows).toContain(`("region" IN ('Nord', 'Süd') OR "region" IS NULL)`);
    expect(rows).toContain("LIMIT 3");
    expect(columns).toContain(`"product" IN ('A')`);
    expect(datasetMarginSql(simple("orders", "region"), "rows", ["x"], "postgres", "all")).toBe("");
    expect(datasetMarginSql(dataset, "rows", [], "postgres", "all")).toBe("");
  });

  test("Tabelle und Pivot zeigen den exakten Gesamtwert statt der geladenen Summe", () => {
    const shape = {
      dimension: DIM_KEY,
      dimension2: DIM2_KEY,
      metrics: [{ key: "m0", label: "Schnitt", agg: "avg" as const }],
      hasDate: false,
    };
    const totals = {
      complete: false,
      pending: false,
      grand: { m0: 42 },
      rows: [{ dim: "Nord", m0: 40 }],
      columns: [{ dim: "A", m0: 41 }],
    };
    const options = { ...DEFAULT_OPTIONS };
    const pivot = renderToStaticMarkup(
      createElement(PivotTable, {
        rows: [{ dim: "Nord", dim2: "A", m0: 10 }],
        shape,
        options,
        totals,
      }),
    );
    expect(pivot).toContain("Gesamt");
    expect(pivot).toContain(">42<");
    expect(pivot).toContain(">40<");
    expect(pivot).toContain(">41<");
    const fallback = renderToStaticMarkup(
      createElement(PivotTable, { rows: [{ dim: "Nord", dim2: "A", m0: 10 }], shape, options }),
    );
    expect(fallback).toContain("Gesamt (geladen)");
    expect(fallback.match(/>–</g)?.length).toBe(3);
    const table = renderToStaticMarkup(
      createElement(DataTable, {
        rows: [
          { dim: "Nord", m0: 1 },
          { dim: "Süd", m0: 2 },
        ],
        shape: { ...shape, dimension2: null },
        options,
        totals: { ...totals, rows: null, columns: null },
      }),
    );
    expect(table).toContain("Gesamt");
    expect(table).toContain(">42<");
  });
});

describe("Re-Review-Korrekturen", () => {
  test("Tabellennamen wie SQL-Schlüsselwörter zählen nur nach FROM oder JOIN", () => {
    const source = simple("order", "status");
    const unrelated = expert("SELECT status, 1 AS umsatz FROM invoices ORDER BY status", "status");
    expect(applyCrossFilters(unrelated, [filterFrom(source, "x")], "t")).toBe(unrelated);
    const related = expert('SELECT status, 1 AS umsatz FROM public."order"', "status");
    expect(applyCrossFilters(related, [filterFrom(source, "x")], "t")).not.toBe(related);
  });

  test("vollständig geladene Ergebnisse zeigen Gesamt aus den geladenen Zeilen", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, {
        rows: [
          { dim: "Nord", m0: 1 },
          { dim: "Süd", m0: 2 },
        ],
        shape: {
          dimension: DIM_KEY,
          dimension2: null,
          metrics: [{ key: "m0", label: "Summe", agg: "sum" as const }],
          hasDate: false,
        },
        options: { ...DEFAULT_OPTIONS },
        totals: { complete: true, pending: false, grand: null, rows: null, columns: null },
      }),
    );
    expect(html).toContain("Gesamt");
    expect(html).toContain(">3<");
    expect(html).not.toContain("tabindex");
  });

  test("interaktive Charts sind per Tastatur erreichbar, andere nicht", () => {
    const props = {
      rows: [{ dim: "Nord", m0: 1 }],
      shape: {
        dimension: DIM_KEY,
        dimension2: null,
        metrics: [{ key: "m0", label: "Summe", agg: "sum" as const }],
        hasDate: false,
      },
      options: { ...DEFAULT_OPTIONS },
    };
    expect(
      renderToStaticMarkup(createElement(DataTable, { ...props, interactive: true })),
    ).toContain('tabindex="0"');
    expect(renderToStaticMarkup(createElement(DataTable, props))).not.toContain("tabindex");
  });
});

describe("Letzte Review-Runde", () => {
  test("Minimum und Maximum werden aus vollständig geladenen Zeilen berechnet", () => {
    const complete = { complete: true, pending: false, grand: null, rows: null, columns: null };
    const table = renderToStaticMarkup(
      createElement(DataTable, {
        rows: [
          { dim: "Nord", m0: 4, m1: 9 },
          { dim: "Süd", m0: 6, m1: 2 },
        ],
        shape: {
          dimension: DIM_KEY,
          dimension2: null,
          metrics: [
            { key: "m0", label: "Summe", agg: "sum" as const },
            { key: "m1", label: "Max", agg: "max" as const },
          ],
          hasDate: false,
        },
        options: { ...DEFAULT_OPTIONS },
        totals: complete,
      }),
    );
    expect(table).toContain(">10<");
    expect(table).toContain(">9<");
    const pivot = renderToStaticMarkup(
      createElement(PivotTable, {
        rows: [
          { dim: "Nord", dim2: "A", m0: 3 },
          { dim: "Nord", dim2: "B", m0: 8 },
          { dim: "Süd", dim2: "A", m0: 5 },
        ],
        shape: {
          dimension: DIM_KEY,
          dimension2: DIM2_KEY,
          metrics: [{ key: "m0", label: "Min", agg: "min" as const }],
          hasDate: false,
        },
        options: { ...DEFAULT_OPTIONS },
        totals: complete,
      }),
    );
    expect(pivot).toContain("Gesamt");
    expect(pivot.match(/>–</g)?.length).toBe(1);
    expect(pivot).toContain('text-right font-medium">5<');
    expect(pivot).toContain(">8</td><td");
  });

  test("Kommajoins und Kommentare werden bei Expertenabfragen erkannt", () => {
    const source = simple("customers", "status");
    const comma = expert("SELECT c.status, 1 AS umsatz FROM orders o, customers c", "status");
    expect(applyCrossFilters(comma, [filterFrom(source, "x")], "t")).not.toBe(comma);
    const literal = expert(
      "SELECT status, 'customers' AS umsatz FROM orders -- customers",
      "status",
    );
    expect(applyCrossFilters(literal, [filterFrom(source, "x")], "t")).toBe(literal);
  });

  test("Spaltenwerte, die Listen sind, werden exakt verglichen", () => {
    const source = simple("orders", "tags");
    const target = simple("orders", "product");
    const sql = datasetSql(
      applyCrossFilters(target, [filterFrom(source, ["a", "b"])], "t"),
      "postgres",
      "all",
    );
    expect(sql).toContain(`"tags" = '["a","b"]'`);
    expect(sql).not.toContain(" IN (");
  });
});

describe("Vierte Review-Runde", () => {
  test("NULL-Gruppen zählen bei Minimum und Maximum nicht als 0", () => {
    expect(combineTotal({ agg: "min" }, [5, null, 7])).toBe(5);
    expect(combineTotal({ agg: "max" }, [-3, null, -1])).toBe(-1);
    expect(combineTotal({ agg: "max" }, [null, null])).toBeNull();
    expect(combineTotal({ agg: "avg" }, [1, 2])).toBeNull();
    expect(combineTotal(undefined, [1])).toBeNull();
    expect(
      combineTotal(
        { agg: "max" },
        Array.from({ length: 200_000 }, (_, i) => i),
      ),
    ).toBe(199_999);
  });

  test("Tabellen werden nur an Tabellenpositionen erkannt", () => {
    const source = simple("customers", "customer_id");
    const literal = expert("SELECT customer_id, 'a--b' AS umsatz FROM customers", "customer_id");
    expect(applyCrossFilters(literal, [filterFrom(source, 1)], "t")).not.toBe(literal);
    const orders = simple("orders", "customer_id");
    const column = expert(
      "SELECT customer_id, count(*) AS orders FROM invoices GROUP BY customer_id",
      "customer_id",
    );
    expect(applyCrossFilters(column, [filterFrom(orders, 1)], "t")).toBe(column);
    const only = expert(
      "SELECT customer_id, 1 AS umsatz FROM ONLY public.customers",
      "customer_id",
    );
    expect(applyCrossFilters(only, [filterFrom(source, 1)], "t")).not.toBe(only);
    const lateral = expert(
      "SELECT x.customer_id, 1 AS umsatz FROM invoices i, LATERAL (SELECT * FROM customers) x",
      "customer_id",
    );
    expect(applyCrossFilters(lateral, [filterFrom(source, 1)], "t")).not.toBe(lateral);
    const selectList = expert("SELECT a, customers FROM invoices", "customer_id");
    expect(applyCrossFilters(selectList, [filterFrom(source, 1)], "t")).toBe(selectList);
  });
});

describe("Tabellenerkennung per Tokenizer", () => {
  const source = simple("customers", "customer_id");
  const reached = (sql: string) => {
    const target = expert(sql, "customer_id");
    return applyCrossFilters(target, [filterFrom(source, 1)], "t") !== target;
  };

  test("erkennt MSSQL-Klammern, Kommajoins nach Unterabfragen und ON", () => {
    expect(reached("SELECT customer_id FROM [public].[customers]")).toBe(true);
    expect(reached("SELECT customer_id FROM [dbo].[customers]")).toBe(false);
    expect(reached("SELECT customer_id FROM [customers] c")).toBe(true);
    expect(reached("SELECT customer_id FROM (SELECT 1 AS x) t, customers")).toBe(true);
    expect(reached("SELECT customer_id FROM a JOIN b ON a.x = b.x, customers")).toBe(true);
    expect(reached("SELECT customer_id FROM a JOIN b USING (x), customers")).toBe(true);
    expect(reached("SELECT customer_id FROM public.customers WHERE 1 = 1")).toBe(true);
  });

  test("ignoriert Funktionsargumente, Spalten, Bezeichner und Zeichenketten", () => {
    expect(reached("SELECT customer_id FROM orders o, generate_series(1, customers.n)")).toBe(
      false,
    );
    expect(reached('SELECT "from", customers FROM orders')).toBe(false);
    expect(reached("SELECT customer_id FROM orders WHERE note = $q$ FROM customers $q$")).toBe(
      false,
    );
    expect(reached("SELECT customer_id FROM orders WHERE customers.id = 1")).toBe(false);
  });

  test("nicht numerische Werte zählen nicht als 0", () => {
    expect(combineTotal({ agg: "min" }, [5, "n/a", 7])).toBe(5);
    expect(combineTotal({ agg: "sum" }, ["2", "x", 3])).toBe(5);
  });
});

describe("Tabellenerkennung mit Dialekten", () => {
  test("erkennt Unicode-Namen, geklammerte Joins und escapte Klammern", () => {
    expect(readsTable("SELECT customer_id FROM größen", "public.größen")).toBe(true);
    expect(readsTable("SELECT 1 FROM (customers c JOIN orders o ON c.id = o.c)", "customers")).toBe(
      true,
    );
    expect(readsTable("SELECT 1 FROM [weird]]name]", "weird]name", "mssql")).toBe(true);
    expect(
      readsTable("SELECT 1 FROM t WHERE a = ARRAY['x]', 'customers']", "customers", "postgres"),
    ).toBe(false);
  });

  test("ignoriert MySQL-Kommentare, Backslash-Escapes und verschachtelte Kommentare", () => {
    expect(readsTable("SELECT 1 FROM orders # FROM customers", "customers", "mysql")).toBe(false);
    expect(readsTable("SELECT 'it\\'s FROM customers' FROM orders", "customers", "mysql")).toBe(
      false,
    );
    expect(readsTable("SELECT 1 FROM orders /* a /* b */ FROM customers */", "customers")).toBe(
      false,
    );
    expect(readsTable("SELECT q'[FROM customers]' FROM orders", "customers", "oracle")).toBe(false);
  });

  test("Leerzeichen, Wahrheitswerte und NaN zählen nicht", () => {
    expect(combineTotal({ agg: "min" }, ["  ", 4, true, Number.NaN, 9])).toBe(4);
    expect(combineTotal({ agg: "sum" }, [1n, "2", 3])).toBe(6);
  });
});

describe("Dialektregeln der Tabellenerkennung", () => {
  test("Kommentare verschachteln nur, wo der Dialekt es tut", () => {
    expect(readsTable("/* a /* b */ SELECT r FROM customers", "customers", "mysql")).toBe(true);
    expect(readsTable("/* a /* b */ SELECT r FROM customers */", "customers", "postgres")).toBe(
      false,
    );
  });

  test("Backslash-Escapes, ODBC-Klammern und kombinierende Zeichen", () => {
    expect(readsTable("SELECT 'it\\'s' t, r FROM orders", "orders", "clickhouse")).toBe(true);
    expect(readsTable("SELECT r FROM [Order Details]", "Order Details", "odbc")).toBe(true);
    expect(readsTable("SELECT r FROM käse", "käse")).toBe(true);
  });
});

describe("Weitere Dialektregeln", () => {
  test("ClickHouse verschachtelt Kommentare, BigQuery kennt # und doppelte Anführungszeichen", () => {
    expect(
      readsTable(
        "/* a /* b */ SELECT r FROM orders */ SELECT r FROM events",
        "orders",
        "clickhouse",
      ),
    ).toBe(false);
    expect(readsTable("# it's\nSELECT r FROM orders", "orders", "bigquery")).toBe(true);
    expect(readsTable('SELECT "a\\"b" AS x, r FROM orders', "orders", "bigquery")).toBe(true);
  });

  test("Array-Indizes sind keine Klammerbezeichner", () => {
    expect(readsTable("SELECT ARRAY[']'] AS a, r FROM orders", "orders", "odbc")).toBe(true);
    expect(readsTable("SELECT a[1], r FROM [orders]", "orders", "odbc")).toBe(true);
  });
});

describe("Klammern und Escapes in Bezeichnern", () => {
  test("Klammerbezeichner direkt nach Schlüsselwörtern und in Dialekten ohne Arrays", () => {
    expect(readsTable("SELECT * FROM[Order Details]", "Order Details", "mssql")).toBe(true);
    expect(readsTable("SELECT x AS[it's], r FROM orders", "orders", "mssql")).toBe(true);
    expect(readsTable("SELECT * FROM[Order Details]", "Order Details", "odbc")).toBe(true);
    expect(readsTable("SELECT a[1], r FROM orders", "orders", "odbc")).toBe(true);
  });

  test("Backslashes beenden MySQL- und Snowflake-Bezeichner nicht", () => {
    expect(readsTable("SELECT `dir\\` , r FROM orders", "orders", "mysql")).toBe(true);
    expect(readsTable('SELECT "C:\\" AS p, r FROM orders', "orders", "snowflake")).toBe(true);
    expect(readsTable("SELECT `a\\`b` AS x, r FROM orders", "orders", "clickhouse")).toBe(true);
  });
});

describe("Schlüsselwörter vor Array-Indizes", () => {
  test("Spaltennamen, die auf Schlüsselwörter enden, bleiben Array-Zugriffe", () => {
    expect(readsTable("SELECT cafe\u0301as[']'], r FROM orders", "orders", "odbc")).toBe(true);
    expect(readsTable("SELECT x.update[']'], r FROM orders", "orders")).toBe(true);
    expect(readsTable("SELECT * FROM[Order Details]", "Order Details")).toBe(true);
    expect(readsTable("SELECT 1.as[it's], r FROM orders", "orders")).toBe(true);
  });

  test("Feldzugriffe nach Namen mit Ziffern, Aufrufen und Leerzeichen bleiben Indizes", () => {
    for (const sql of [
      "SELECT t1.as[']'], r FROM orders",
      "SELECT col2.from[']'], r FROM orders",
      "SELECT t1.update[']'], r FROM orders",
      "SELECT t1.as['a]b'], r FROM orders",
      "SELECT o2.select[']'], r FROM orders",
      "SELECT f(x).as[']'], r FROM orders",
      "SELECT t .as[']'], r FROM orders",
      "SELECT a[1][']'], r FROM orders",
    ]) {
      expect(readsTable(sql, "orders", "odbc")).toBe(true);
      expect(readsTable(sql, "orders")).toBe(true);
    }
  });
});

describe("Klammernamen nach Operatoren", () => {
  test("Operatoren, Semikolons und Kommentare vor Klammern ergeben Bezeichner", () => {
    for (const sql of [
      "SELECT a*[Unit's Price] FROM orders",
      "SELECT a+[it's] FROM orders",
      "SELECT a-[it's] FROM orders",
      "SELECT a FROM t WHERE x=[it's] UNION SELECT * FROM orders",
      "SELECT a/*c*/[it's] FROM orders",
      "SELECT a FROM t;[it's] SELECT 1 FROM orders",
    ]) {
      expect(readsTable(sql, "orders", "odbc")).toBe(true);
      expect(readsTable(sql, "orders")).toBe(true);
    }
  });
});

describe("Array-Indizes nach Kommentaren und Leerzeichen", () => {
  test("Inhalt mit Anführungszeichen oder Ziffer ist ein Index, sonst ein Klammername", () => {
    for (const kind of ["odbc", null] as const) {
      expect(readsTable("SELECT a/*c*/[']'], r FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT a /*c*/ [']'], r FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT a [1], r FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT a/*c*/[it's] FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT a [Unit's Price] FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT x [1990's Sales] FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT sum(x) [2nd Customer's Name] FROM orders", "orders", kind)).toBe(
        true,
      );
      expect(readsTable("SELECT CASE WHEN a THEN b END [1st's] FROM orders", "orders", kind)).toBe(
        true,
      );
      expect(readsTable("SELECT a [$1 || ']'] FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT data ['k' || ']'] FROM orders", "orders", kind)).toBe(true);
      expect(readsTable(`SELECT a ['${"x".repeat(300)}]'] FROM orders`, "orders", kind)).toBe(true);
      expect(readsTable("SELECT a [1e3 || ']'] FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT a [:größe || ']'] FROM orders", "orders", kind)).toBe(true);
      for (const sql of [
        "SELECT total [1990's Sales] FROM orders WHERE note = 'a]b'",
        "SELECT total [1990's Sales] FROM orders o JOIN [Leon's Shop] s ON o.id = s.id",
        "SELECT a [Unit's Price], b FROM orders WHERE c = 'x]'",
        "SELECT x [1990's Sales] FROM orders WHERE n = 'it''s]'",
      ])
        expect(readsTable(sql, "orders", kind)).toBe(true);
    }
  });
});

describe("Mehrdeutige Klammern mit beiden Lesarten", () => {
  test("String-Präfixe, gemischte Aliase und Indizes und schließende Anführungszeichen", () => {
    for (const kind of ["odbc", null] as const) {
      expect(
        readsTable("SELECT a [Plan X's cost], b FROM orders WHERE s = ']'", "orders", kind),
      ).toBe(true);
      expect(
        readsTable("SELECT count(*) [Count 'VIP' from orders] FROM customers", "orders", kind),
      ).toBe(false);
      expect(
        readsTable("SELECT x [1990's Sales], data ['k' || ']'] FROM orders", "orders", kind),
      ).toBe(true);
      expect(readsTable("SELECT a ['x'y], r FROM orders", "orders", kind)).toBe(true);
      expect(readsTable("SELECT a [US$'s] FROM orders WHERE c = 'x]'", "orders", kind)).toBe(true);
    }
  });
});

describe("ODBC-Dialekt aus dem Treiber", () => {
  test("erkennt den Dialekt hinter ODBC und lässt andere Arten unverändert", () => {
    expect(tableDialect("odbc", "Driver={PostgreSQL Unicode};Server=db;Database=x")).toBe(
      "postgres",
    );
    expect(tableDialect("odbc", "Driver={ODBC Driver 18 for SQL Server};Server=db")).toBe("mssql");
    expect(tableDialect("odbc", "DRIVER=MySQL ODBC 8.0 Unicode Driver;SERVER=db")).toBe("mysql");
    expect(tableDialect("odbc", "DSN=Lager")).toBe("odbc");
    expect(tableDialect("odbc", "odbc://u:p@h:5432/db?Driver=PostgreSQL%20Unicode")).toBe(
      "postgres",
    );
    expect(
      tableDialect(
        "odbc",
        "odbc://u:p@h/db?Server=h&Driver=ODBC%20Driver%2018%20for%20SQL%20Server",
      ),
    ).toBe("mssql");
    expect(tableDialect("odbc", "odbc://h/db?Driver=ODBC+Driver+18+for+SQL+Server")).toBe("mssql");
    expect(
      tableDialect("odbc", "Driver=/opt/microsoft/msodbcsql18/lib64/libmsodbcsql-18.so;Server=h"),
    ).toBe("mssql");
    expect(tableDialect("odbc", "Driver={SQL Native Client};Server=h")).toBe("mssql");
    expect(tableDialect("odbc", "Driver=/usr/lib/libmyodbc8w.so;Server=h")).toBe("mysql");
    expect(tableDialect("odbc", "Driver=/opt/oracle/libsqora.so.19.1;DBQ=h")).toBe("oracle");
    expect(tableDialect("odbc", "odbc://h/db?Driver=%E0%A4%A")).toBe("odbc");
    expect(tableDialect("postgres", "Driver={SQL Server}")).toBe("postgres");
    expect(tableDialect(undefined, null)).toBeNull();
  });

  test("PostgreSQL hinter ODBC liest Escape-Strings als Index, SQL Server Klammern als Namen", () => {
    const postgres = tableDialect("odbc", "Driver={PostgreSQL Unicode};Server=db");
    expect(readsTable("SELECT data [E'x]'] FROM orders", "orders", postgres)).toBe(true);
    const mssql = tableDialect("odbc", "Driver={ODBC Driver 18 for SQL Server};Server=db");
    expect(readsTable("SELECT a [Team E's score] FROM orders WHERE s = ']'", "orders", mssql)).toBe(
      true,
    );
  });
});

describe("Abschluss-Review", () => {
  test("ODBC mit MySQL-Treiber maskiert Backslashes, unbekanntes ODBC setzt sie nie ein", () => {
    const source = simple("orders", "region");
    const target = simple("orders", "product");
    const mysql = tableDialect("odbc", "Driver={MySQL ODBC 8.0 Unicode Driver};Server=h");
    const injected = "\\' OR 1=1 -- ";
    const sql = datasetSql(
      applyCrossFilters(target, [filterFrom(source, injected)], "t", mysql),
      mysql,
      "all",
    );
    expect(sql).toContain("CHAR(92 USING utf8mb4)");
    expect(sql).not.toContain("'\\'");
    const unknown = datasetSql(
      applyCrossFilters(target, [filterFrom(source, injected)], "t", "odbc"),
      "odbc",
      "all",
    );
    expect(unknown).toContain(`"region" = '\\\\'' OR 1=1 -- '`);
  });

  test("Filter aus Expertenabfragen erreichen nur Abfragen auf denselben Tabellen", () => {
    const customers = expert(
      "SELECT name, COUNT(*) AS umsatz FROM customers GROUP BY name",
      "name",
    );
    const products = expert("SELECT name, COUNT(*) AS umsatz FROM products GROUP BY name", "name");
    const others = expert(
      "SELECT c.name, 1 AS umsatz FROM customers c JOIN orders o ON o.c = c.id",
      "name",
    );
    const field = crossField(customers, DIM_KEY);
    if (!field) throw new Error("Feld fehlt");
    const filter: CrossFilter = { widgetId: "a", key: DIM_KEY, field, value: "Acme", label: "x" };
    expect(applyCrossFilters(products, [filter], "b")).toBe(products);
    expect(applyCrossFilters(others, [filter], "c")).not.toBe(others);
  });

  test("Schemas und CTE-Namen werden unterschieden", () => {
    expect(readsTable("SELECT * FROM archive.orders", "sales.orders")).toBe(false);
    expect(readsTable("SELECT * FROM sales.orders", "sales.orders")).toBe(true);
    expect(readsTable("SELECT * FROM orders", "sales.orders")).toBe(true);
    expect(readsTable("WITH orders AS (SELECT 1) SELECT * FROM orders", "sales.orders")).toBe(
      false,
    );
    expect(
      readsTable(
        "WITH x AS (SELECT * FROM orders), y (a) AS (SELECT 1) SELECT * FROM x, y",
        "orders",
      ),
    ).toBe(true);
  });
});

describe("SQL Server mit eigenem SQL", () => {
  test("CTEs werden angehängt statt verschachtelt", () => {
    const dataset = expert(
      "WITH t AS (SELECT region, 1 AS umsatz FROM orders) SELECT region, umsatz FROM t;",
      "region",
    );
    const sql = datasetDetailSql(
      dataset,
      [{ ref: "region", bucket: "none", value: "Nord" }],
      "mssql",
      "all",
    );
    expect(sql).toBe(
      "WITH t AS (SELECT region, 1 AS umsatz FROM orders),\nl8db_q AS (\nSELECT region, umsatz FROM t\n)\nSELECT TOP 200 * FROM l8db_q AS q WHERE q.[region] = N'Nord'",
    );
  });

  test("ORDER BY ohne TOP bekommt ein TOP, vorhandene Begrenzungen bleiben", () => {
    const ordered = expert(
      "SELECT DISTINCT region, SUM(x) AS umsatz FROM orders GROUP BY region ORDER BY umsatz DESC",
      "region",
    );
    const filtered = datasetSql(
      applyCrossFilters(ordered, [filterFrom(simple("orders", "region"), "Nord")], "t", "mssql"),
      "mssql",
      "all",
    );
    expect(filtered).toContain("ORDER BY umsatz DESC OFFSET 0 ROWS");
    expect(filtered).toContain(") AS q WHERE q.[region] = N'Nord'");
    const top = expert("SELECT TOP 5 region, x AS umsatz FROM orders ORDER BY x", "region");
    expect(datasetDetailSql(top, [], "mssql", "all")).toContain("SELECT TOP 5 region");
    const offset = expert(
      "SELECT region, x AS umsatz FROM orders ORDER BY x OFFSET 0 ROWS",
      "region",
    );
    expect(datasetDetailSql(offset, [], "mssql", "all")).not.toContain("OFFSET 0 ROWS OFFSET");
    const nested = expert(
      "SELECT region, (SELECT TOP 1 y FROM z ORDER BY y) AS umsatz FROM orders",
      "region",
    );
    expect(datasetDetailSql(nested, [], "mssql", "all")).not.toContain("OFFSET 0 ROWS");
  });
});

describe("Verwaiste Filter und Oracle-Sitzungsformat", () => {
  test("Filter verfallen, wenn Quelle, Option oder Feld wegfallen", () => {
    const dataset = { ...simple("orders", "region"), id: "ds-a" };
    const field = crossField(dataset, DIM_KEY);
    if (!field) throw new Error("Feld fehlt");
    const filter: CrossFilter = { widgetId: "a", key: DIM_KEY, field, value: "Nord", label: "x" };
    const board = { widgets: [widget("a", undefined, { datasetId: "ds-a" })], datasets: [dataset] };
    expect(staleFilter(filter, board, null)).toBe(false);
    expect(staleFilter(filter, { ...board, widgets: [] }, null)).toBe(true);
    expect(
      staleFilter(
        filter,
        {
          ...board,
          widgets: [widget("a", undefined, { datasetId: "ds-a", options: { crossFilter: false } })],
        },
        null,
      ),
    ).toBe(true);
    const moved = { ...simple("orders", "country"), id: "ds-a" };
    expect(staleFilter(filter, { ...board, datasets: [moved] }, null)).toBe(true);
  });

  test("Oracle vergleicht ungebuckelte Datumswerte im Sitzungsformat des Adapters", () => {
    const source = simple("orders", "created_at");
    const target = simple("orders", "product");
    const sql = datasetSql(
      applyCrossFilters(target, [filterFrom(source, "2024-03-01 10:30:00")], "t"),
      "oracle",
      "all",
    );
    expect(sql).toContain(`"created_at" = '2024-03-01 10:30:00'`);
  });
});

describe("Zweite Abschlussrunde", () => {
  test("Expertenauswahlen erreichen keine Baukasten-Charts über Aliase", () => {
    const source = expert(
      "SELECT region AS r, COUNT(*) AS umsatz FROM orders GROUP BY region",
      "r",
    );
    const field = crossField(source, DIM_KEY);
    if (!field) throw new Error("Feld fehlt");
    const builder = simple("orders", "status");
    const filter: CrossFilter = { widgetId: "a", key: DIM_KEY, field, value: "EU", label: "x" };
    expect(applyCrossFilters(builder, [filter], "b")).toBe(builder);
  });

  test("SQL Server: Trend über CTE und ORDER BY sowie UNION mit ORDER BY", () => {
    const dataset = expert("WITH x AS (SELECT d, n FROM t) SELECT d, n FROM x ORDER BY d", "d");
    dataset.mapping = { dimension: null, dimension2: null, metrics: ["n"], dateColumn: "d" };
    const trend = datasetTrendSql(dataset, "mssql", "30d");
    expect(trend.startsWith("WITH x AS (SELECT d, n FROM t),\nl8db_q AS (")).toBe(true);
    expect(trend).toContain("l8db_t AS (\nSELECT * FROM l8db_q AS q WHERE");
    expect(trend).not.toContain("FROM (\nWITH");
    const ordered = expert("SELECT d, n FROM t ORDER BY d", "d");
    ordered.mapping = { dimension: null, dimension2: null, metrics: ["n"], dateColumn: "d" };
    expect(datasetTrendSql(ordered, "mssql", "all")).toContain(
      "SELECT d, n FROM t ORDER BY d OFFSET 0 ROWS",
    );
    const union = expert("SELECT a FROM t UNION ALL SELECT a FROM u ORDER BY a", "a");
    expect(datasetDetailSql(union, [], "mssql", "all")).toContain(
      "SELECT a FROM t UNION ALL SELECT a FROM u ORDER BY a OFFSET 0 ROWS",
    );
  });

  test("DSN-ODBC setzt Backslash-Werte aus Filtern und Variablen nie ein", () => {
    const dataset = simple("orders", "region");
    dataset.simple.filters = [
      { id: "f", column: "status", operator: "eq", value: "x\\' OR 1=1 -- " },
    ];
    const sql = datasetSql(dataset, "odbc", "all");
    expect(sql).toContain(`"status" = 'x\\\\'' OR 1=1 -- '`);
    expect(sql).not.toContain("1 = 0");
    const variable = { id: "v", name: "q", label: "q", type: "text" as const, defaultValue: "" };
    expect(variableLiteral(variable, "x\\' OR 1=1 -- ", "odbc")).toBe("'x\\\\'' OR 1=1 --'");
    expect(variableLiteral(variable, "C:\\data", "odbc")).toBe("'C:\\\\data'");
    expect(variableLiteral(variable, "Nord", "odbc")).toBe("'Nord'");
  });
});

describe("Dritte Abschlussrunde", () => {
  test("SQL Server: Kommentar nach CTEs, TOP im ersten UNION-Zweig, qualifiziertes ORDER BY", () => {
    const commented = expert("WITH x AS (SELECT 1 AS a) -- note\nSELECT a FROM x ORDER BY a", "a");
    commented.mapping = { dimension: null, dimension2: null, metrics: ["a"], dateColumn: "a" };
    const trend = datasetTrendSql(commented, "mssql", "all");
    expect(trend.startsWith("WITH x AS (SELECT 1 AS a),\nl8db_t AS (")).toBe(true);
    expect(trend).not.toContain("-- note");
    const topUnion = expert("SELECT TOP 5 a FROM t UNION ALL SELECT a FROM u ORDER BY a", "a");
    expect(datasetDetailSql(topUnion, [], "mssql", "all")).toContain("ORDER BY a OFFSET 0 ROWS");
    const qualified = expert(
      "SELECT t.a, t.b FROM t UNION ALL SELECT u.a, u.b FROM u ORDER BY t.a DESC, [dbo].[t].[b]",
      "a",
    );
    expect(datasetDetailSql(qualified, [], "mssql", "all")).toContain(
      "ORDER BY t.a DESC, [dbo].[t].[b] OFFSET 0 ROWS",
    );
  });
});

describe("Vierte Abschlussrunde", () => {
  const union = (order: string) =>
    datasetDetailSql(
      expert(`SELECT t.a AS x, t.b FROM t UNION ALL SELECT u.a, u.b FROM u ${order}`, "x"),
      [],
      "mssql",
      "all",
    );

  test("ORDER BY bleibt unverändert und wird mit OFFSET 0 ROWS gültig", () => {
    expect(union("ORDER BY x, 2 DESC")).toContain("ORDER BY x, 2 DESC OFFSET 0 ROWS");
    expect(union("ORDER BY -t.a")).toContain("ORDER BY -t.a OFFSET 0 ROWS");
    expect(union("ORDER BY t.b COLLATE Latin1_General_CS_AS")).toContain(
      "COLLATE Latin1_General_CS_AS OFFSET 0 ROWS",
    );
    expect(union("ORDER BY dbo.fn(t.a) -- sort")).toContain(
      "ORDER BY dbo.fn(t.a) OFFSET 0 ROWS -- sort",
    );
    const top = expert("SELECT TOP 5 a, b FROM t ORDER BY a", "a");
    expect(datasetDetailSql(top, [], "mssql", "all")).not.toContain("OFFSET 0 ROWS");
  });

  test("CTE mit Kommentar auch im Wrapper für Details und Filter", () => {
    const dataset = expert("WITH x AS (SELECT 1 AS a) -- note\nSELECT a FROM x", "a");
    const sql = datasetDetailSql(dataset, [{ ref: "a", bucket: "none", value: 1 }], "mssql", "all");
    expect(sql.startsWith("WITH x AS (SELECT 1 AS a),\nl8db_q AS (")).toBe(true);
    expect(sql).not.toContain("-- note");
  });

  test("Listenfilter behalten JSON-Escapes und verdoppeln nur echte Backslashes auf DSN-ODBC", () => {
    const dataset = simple("orders", "region");
    dataset.simple.filters = [
      {
        id: "f",
        column: "status",
        operator: "in",
        value: JSON.stringify(['say "hi"', "C:\\data", "b"]),
      },
    ];
    const sql = datasetSql(dataset, "odbc", "all");
    expect(sql).toContain(`"status" IN ('say "hi"', 'C:\\\\data', 'b')`);
    dataset.simple.filters[0].operator = "notIn";
    expect(datasetSql(dataset, "odbc", "all")).toContain(`NOT IN ('say "hi"', 'C:\\\\data', 'b')`);
    expect(datasetSql(dataset, null, "all")).toContain(`NOT IN ('say "hi"', E'C:\\\\data', 'b')`);
  });
});
