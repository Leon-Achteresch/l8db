import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { PivotTable } from "../src/features/dashboard/charts/pivot-table";
import {
  applyCrossFilters,
  type CrossFilter,
  crossField,
  type Dataset,
  DEFAULT_OPTIONS,
  DIM_KEY,
  DIM2_KEY,
  datasetMarginSql,
  datasetSql,
  datasetTotalsSql,
  emptyDataset,
  joinId,
  sanitizeTheme,
  themeCss,
  useCrossFilterStore,
} from "../src/lib/dashboards";

function dataset(table: string, dimension: string, joined = false): Dataset {
  const base = emptyDataset(table);
  base.simple = {
    ...base.simple,
    schema: "public",
    table,
    dimension: { column: dimension, bucket: "none" },
    metrics: [{ id: "m", agg: "sum", column: "amount", label: "Umsatz" }],
  };
  if (joined) {
    const join = { schema: "public", table: "orders", fromColumn: "order_id", toColumn: "id" };
    base.simple.joins = [{ ...join, id: joinId(null, join), parent: null }];
  }
  return base;
}

test("cross filters over 60 widgets only rebuild the affected queries", async () => {
  const widgets = Array.from({ length: 60 }, (_, index) =>
    index < 20
      ? dataset("orders", `col${index}`)
      : index < 40
        ? dataset("order_items", `col${index}`, true)
        : dataset(`other_${index}`, `col${index}`),
  );
  const filters: CrossFilter[] = ["region", "channel", "segment", "country"].map((column, i) => {
    const source = dataset("orders", column);
    const field = crossField(source, DIM_KEY);
    if (!field) throw new Error("field");
    return { widgetId: `source-${i}`, key: DIM_KEY, field, value: `Wert ${i}`, label: column };
  });
  const baseline = widgets.map((w) => datasetSql(w, "postgres", "30d"));
  let changed = 0;
  let unchanged = 0;
  const timing = await measureScenario(() => {
    changed = 0;
    unchanged = 0;
    widgets.forEach((widget, index) => {
      const filtered = applyCrossFilters(widget, filters, `w${index}`);
      if (filtered === widget) unchanged++;
      const sql = datasetSql(filtered, "postgres", "30d");
      datasetTotalsSql(filtered, "postgres", "30d");
      if (sql !== baseline[index]) changed++;
    });
  }, 21);
  await reportScenario("dashboard-cross-filter-fanout", {
    ...timing,
    widgets: widgets.length,
    filters: filters.length,
    rebuiltQueries: changed,
    untouchedWidgets: unchanged,
  });
  expect(changed).toBe(40);
  expect(unchanged).toBe(20);
  expect(timing.p95Ms).toBeLessThan(25);
});

test("pivot with 60 x 40 cells renders bounded markup quickly", async () => {
  const rows = Array.from({ length: 2400 }, (_, index) => ({
    dim: `Zeile ${Math.floor(index / 40)}`,
    dim2: `Spalte ${index % 40}`,
    m0: (index * 37) % 1000,
  }));
  const shape = {
    dimension: DIM_KEY,
    dimension2: DIM2_KEY,
    metrics: [{ key: "m0", label: "Umsatz", agg: "sum" as const }],
    hasDate: false,
  };
  let cells = 0;
  const timing = await measureScenario(() => {
    const html = renderToStaticMarkup(
      createElement(PivotTable, {
        rows,
        shape,
        options: { ...DEFAULT_OPTIONS, dataBars: true },
      }),
    );
    cells = html.split("<td").length - 1;
  }, 9);
  await reportScenario("dashboard-pivot-render", {
    ...timing,
    sourceRows: rows.length,
    renderedCells: cells,
  });
  expect(cells).toBe(60 * 40 + 60 + 40 + 1);
  expect(timing.p95Ms).toBeLessThan(250);
});

test("theme with a 512 KiB logo validates and compiles quickly", async () => {
  const logo = `data:image/png;base64,${"A".repeat(Math.floor((512 * 1024 * 4) / 3))}`;
  let cssBytes = 0;
  const timing = await measureScenario(() => {
    const theme = sanitizeTheme({
      brand: "ACME",
      logo,
      primary: "#1d4ed8",
      palette: ["#111111", "#222222", "#333333", "#444444"],
      font: "inter",
      card: "elevated",
      radius: 12,
    });
    cssBytes = themeCss(theme).length;
  }, 21);
  await reportScenario("dashboard-theme-compile", { ...timing, logoBytes: logo.length, cssBytes });
  expect(cssBytes).toBeLessThan(4096);
  expect(timing.p95Ms).toBeLessThan(10);
});

test("toggling 1,000 selections keeps one filter per widget and field", async () => {
  const store = useCrossFilterStore.getState();
  const source = dataset("orders", "region");
  const field = crossField(source, DIM_KEY);
  if (!field) throw new Error("field");
  const timing = await measureScenario(() => {
    store.clear("perf");
    for (let i = 0; i < 1000; i++)
      store.toggle("perf", {
        widgetId: `w${i % 10}`,
        key: DIM_KEY,
        field,
        value: `Wert ${i % 7}`,
        label: "x",
      });
  }, 9);
  const retained = useCrossFilterStore.getState().filters.perf.length;
  await reportScenario("dashboard-cross-filter-store", { ...timing, toggles: 1000, retained });
  store.clear("perf");
  expect(retained).toBeLessThanOrEqual(10);
  expect(timing.p95Ms).toBeLessThan(100);
});

test("exact pivot totals add a bounded number of queries per chart", async () => {
  const pivots = Array.from({ length: 60 }, (_, index) => {
    const base = dataset(`table_${index % 12}`, "region");
    base.simple.dimension2 = "product";
    return base;
  });
  const regions = Array.from({ length: 50 }, (_, i) => `Region ${i}`);
  const products = Array.from({ length: 40 }, (_, i) => `Produkt ${i}`);
  let queries = 0;
  const timing = await measureScenario(() => {
    const distinct = new Set<string>();
    for (const pivot of pivots) {
      distinct.add(datasetSql(pivot, "postgres", "30d"));
      distinct.add(datasetTotalsSql(pivot, "postgres", "30d"));
      distinct.add(datasetMarginSql(pivot, "rows", regions, "postgres", "30d"));
      distinct.add(datasetMarginSql(pivot, "columns", products, "postgres", "30d"));
    }
    queries = distinct.size;
  }, 21);
  await reportScenario("dashboard-pivot-totals-queries", {
    ...timing,
    pivots: pivots.length,
    distinctQueries: queries,
  });
  expect(queries).toBe(12 * 4);
  expect(timing.p95Ms).toBeLessThan(25);
});
