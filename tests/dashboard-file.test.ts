import { expect, test } from "bun:test";
import { fileLabel, parseDashboard, serializeDashboard } from "../src/lib/dashboard-file";
import type { Dashboard } from "../src/lib/dashboards";

const dashboard: Dashboard = {
  id: "local-id",
  connectionId: "conn-1",
  database: "app",
  name: "Sales",
  datasets: [],
  widgets: [],
  refreshSec: 60,
  locked: true,
  createdAt: 123,
  filePath: "/repo/sales.json",
  fileStamp: "1:2",
};

test("serialize strips machine-local fields", () => {
  const written = JSON.parse(serializeDashboard(dashboard));
  expect(written).toEqual({
    name: "Sales",
    datasets: [],
    widgets: [],
    refreshSec: 60,
    locked: true,
  });
});

test("roundtrip", () => {
  expect(parseDashboard(serializeDashboard(dashboard)).name).toBe("Sales");
});

test("rejects foreign json", () => {
  expect(() => parseDashboard('{"name":"x"}')).toThrow();
});

test("fileLabel handles both separators", () => {
  expect(fileLabel("/mnt/share/a.json")).toBe("a.json");
  expect(fileLabel("\\\\srv\\share\\a.json")).toBe("a.json");
});
