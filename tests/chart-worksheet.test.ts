import { expect, test } from "bun:test";
import {
  colorSeries,
  fieldPlacement,
  newWorksheet,
  placeField,
  ROW_COUNT_FIELD,
  updateWorksheet,
  type WorksheetField,
} from "../src/lib/chart-worksheet";
import { buildSimpleSql, type Dashboard, datasetShape } from "../src/lib/dashboards";

const dashboard: Dashboard = {
  id: "d",
  connectionId: "c",
  database: "demo",
  name: "Demo",
  datasets: [],
  widgets: [],
  refreshSec: 0,
  locked: false,
  createdAt: 0,
};
const amount: WorksheetField = { ref: "amount", label: "amount", dataType: "numeric" };
const country: WorksheetField = { ref: "country", label: "country", dataType: "text" };
const date: WorksheetField = { ref: "created_at", label: "created_at", dataType: "timestamp" };

test("chart comes before data, then dimensions and measures produce grouped SQL", () => {
  let sheet = newWorksheet(dashboard, "column");
  expect(sheet.dataset.simple.metrics).toEqual([]);
  sheet.dataset.simple.table = "orders";
  sheet.dataset.simple.schema = "public";
  sheet = placeField(sheet, amount, "rows");
  sheet = placeField(sheet, date, "columns");
  expect(sheet.dataset.simple.metrics[0].agg).toBe("sum");
  expect(sheet.dataset.simple.dimension?.bucket).toBe("month");
  expect(buildSimpleSql(sheet.dataset.simple, "postgres")).toContain(
    "GROUP BY date_trunc('month', \"created_at\")",
  );
  sheet = placeField(sheet, country, "color");
  expect(buildSimpleSql(sheet.dataset.simple, "postgres")).toContain(
    'GROUP BY date_trunc(\'month\', "created_at"), "country"',
  );
});

test("dragging a category to rows rotates bars while keeping the measure", () => {
  let sheet = placeField(newWorksheet(dashboard, "column"), amount, "rows");
  sheet = placeField(sheet, country, "rows");
  expect(sheet.widget.options?.horizontal).toBe(true);
  expect(sheet.dataset.simple.dimension?.column).toBe("country");
  expect(sheet.dataset.simple.metrics[0].column).toBe("amount");
});

test("editing a shared legacy source creates an independent chart source", () => {
  const sheet = newWorksheet(dashboard, "column");
  const other = { ...sheet.widget, id: "other" };
  const original = { ...dashboard, datasets: [sheet.dataset], widgets: [sheet.widget, other] };
  const patch = updateWorksheet(original, sheet.widget.id, placeField(sheet, amount, "rows"));
  expect(patch.datasets?.length).toBe(2);
  expect(patch.datasets?.[0]).toEqual(sheet.dataset);
  expect(patch.widgets?.[0].datasetId).not.toBe(other.datasetId);
  expect(patch.widgets?.[1]).toEqual(other);
});

test("a drop only accepts fields from the active chart metadata", () => {
  expect(fieldPlacement('{"chartId":"other","fieldRef":"amount"}', "current", [amount])).toBeNull();
  expect(
    fieldPlacement('{"chartId":"current","fieldRef":"unknown"}', "current", [amount]),
  ).toBeNull();
  expect(fieldPlacement("invalid", "current", [amount])).toBeNull();
  expect(
    fieldPlacement('{"chartId":"current","fieldRef":"amount"}', "current", [amount])?.field,
  ).toEqual(amount);
});

test("color grouping becomes separate series, without losing values", () => {
  const shape = {
    dimension: "dim",
    dimension2: "dim2",
    metrics: [{ key: "m0", label: "Umsatz" }],
    hasDate: false,
  };
  const result = colorSeries("column", shape, [
    { dim: "Jan", dim2: "DE", m0: 20 },
    { dim: "Jan", dim2: "US", m0: 35 },
    { dim: "Feb", dim2: "DE", m0: 10 },
  ]);
  expect(result.shape.metrics.map((m) => m.label)).toEqual(["DE", "US"]);
  expect(result.rows).toEqual([
    { dim: "Jan", series_0_0: 20, series_1_0: 35 },
    { dim: "Feb", series_0_0: 10 },
  ]);
  expect(colorSeries("heatmap", shape, [])).toEqual({ shape, rows: [] });
});

test("count rows needs no numeric column", () => {
  const sheet = placeField(
    newWorksheet(dashboard, "kpi"),
    { ref: ROW_COUNT_FIELD, label: "Anzahl Zeilen", dataType: "integer" },
    "rows",
  );
  expect(datasetShape(sheet.dataset).metrics).toHaveLength(1);
  sheet.dataset.simple.table = "orders";
  expect(buildSimpleSql(sheet.dataset.simple, "postgres")).toContain('COUNT(*) AS "m0"');
});
