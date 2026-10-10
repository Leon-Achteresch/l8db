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
  themeCss,
  themeShowsHeader,
  useCrossFilterStore,
  type Widget,
  widgetsOnPage,
} from "../src/lib/dashboards";
import { readsTable } from "../src/lib/dashboards/sql-tables";

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
    expect(sql.endsWith(`) AS d LIMIT ${DETAIL_LIMIT}`)).toBe(true);
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
    expect(reached("SELECT customer_id FROM [dbo].[customers]")).toBe(true);
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
