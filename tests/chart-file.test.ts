import { expect, test } from "bun:test";
import { insertChartFile, makeChartFile, parseChartFile } from "../src/lib/chart-file";
import { type Dashboard, emptyDataset, type Widget } from "../src/lib/dashboards";

const dashboard: Dashboard = {
  id: "d",
  connectionId: "private-connection",
  database: "private-db",
  name: "Demo",
  datasets: [],
  widgets: [],
  refreshSec: 0,
  locked: false,
  createdAt: 0,
};

function newSource() {
  const dataset = emptyDataset("Demo");
  const widget: Widget = {
    id: "w",
    chart: "column",
    datasetId: dataset.id,
    title: "Demo",
    period: "all",
    x: 0,
    y: 0,
    w: 6,
    h: 6,
  };
  return { dataset, widget };
}

test("chart files preserve source and presentation without dashboard connection metadata", () => {
  const source = newSource();
  source.dataset.simple.table = "orders";
  source.dataset.simple.filters = [{ id: "f", column: "amount", operator: "gte", value: "100" }];
  source.widget.options = { horizontal: true };
  const file = parseChartFile(JSON.stringify(makeChartFile(source.widget, source.dataset)));
  expect(file.dataset.simple).toEqual(source.dataset.simple);
  expect(file.widget.options?.horizontal).toBe(true);
  expect(JSON.stringify(file)).not.toContain("private-connection");
  expect(JSON.stringify(file)).not.toContain("private-db");
  const first = insertChartFile(dashboard, file);
  const second = insertChartFile({ ...dashboard, widgets: [first.widget] }, file);
  expect(first.widget.id).not.toBe(second.widget.id);
  expect(first.dataset.id).not.toBe(second.dataset.id);
  first.dataset.simple.filters[0].value = "200";
  expect(second.dataset.simple.filters[0].value).toBe("100");
  expect(file.dataset.simple.filters[0].value).toBe("100");
});

test("unsupported or incomplete chart files are rejected before inserting", () => {
  expect(() => parseChartFile("null")).toThrow();
  expect(() => parseChartFile('{"format":"l8db-chart","version":99}')).toThrow();
  const source = newSource();
  const file = makeChartFile(source.widget, source.dataset);
  expect(() => parseChartFile(JSON.stringify({ ...file, widget: { chart: "unknown" } }))).toThrow();
  expect(() =>
    parseChartFile(JSON.stringify({ ...file, dataset: { ...file.dataset, simple: {} } })),
  ).toThrow();
});
