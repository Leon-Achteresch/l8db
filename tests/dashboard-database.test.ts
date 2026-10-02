import { expect, test } from "bun:test";
import { dashboardDatabaseSwitch } from "../src/lib/dashboards/database";

test("opening a dashboard switches to the database it was created for once", () => {
  const sales = { id: "d1", database: "sales" };
  expect(dashboardDatabaseSwitch(sales, "hr", null)).toBe("sales");
  expect(dashboardDatabaseSwitch(sales, null, null)).toBe("sales");
  expect(dashboardDatabaseSwitch(sales, "hr", "d2")).toBe("sales");
  expect(dashboardDatabaseSwitch(sales, "sales", null)).toBeNull();
  expect(dashboardDatabaseSwitch(sales, "hr", "d1")).toBeNull();
  expect(dashboardDatabaseSwitch({ id: "d3", database: null }, "hr", null)).toBeNull();
  expect(dashboardDatabaseSwitch({ id: "d4", database: "" }, "hr", null)).toBeNull();
  expect(dashboardDatabaseSwitch(null, "hr", null)).toBeNull();
});
