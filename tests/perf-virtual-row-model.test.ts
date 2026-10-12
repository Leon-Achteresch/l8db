import { expect, test } from "bun:test";
import { createTable } from "@tanstack/react-table";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { getVirtualRowModel } from "../src/lib/virtual-row-model";

const data = Array.from({ length: 100_000 }, (_, index) => ({ id: `row-${index}`, value: index }));

test("accessing 40 visible row IDs in a 100,000-row result never scans offscreen IDs", async () => {
  let idLookups = 0;
  const timing = await measureScenario(() => {
    idLookups = 0;
    const grid = createTable({
      data,
      columns: [{ accessorKey: "value" }],
      getRowId: (row) => {
        idLookups++;
        return row.id;
      },
      getCoreRowModel: getVirtualRowModel(),
      state: {},
      onStateChange: () => undefined,
      renderFallbackValue: null,
    });
    const model = grid.getRowModel();
    for (let index = 50_000; index < 50_040; index++) {
      const row = model.rows[index];
      expect(grid.getRow(row.id)).toBe(row);
      expect(row.id in model.rowsById).toBe(true);
      expect(Object.getOwnPropertyDescriptor(model.rowsById, row.id)?.get?.()).toBe(row);
    }
    expect(idLookups).toBe(40);
  });
  await reportScenario("virtual-row-visible-ids", {
    ...timing,
    sourceRows: data.length,
    idLookups,
  });
  expect(timing.p95Ms).toBeLessThan(50);
});

test("default numeric IDs resolve an arbitrary offscreen row without allocating a full ID index", async () => {
  let created = 0;
  const grid = createTable({
    data,
    columns: [{ accessorKey: "value" }],
    getCoreRowModel: getVirtualRowModel(),
    state: {},
    onStateChange: () => undefined,
    renderFallbackValue: null,
  });
  grid._features.push({
    createRow: () => {
      created++;
    },
  });
  const timing = await measureScenario(() => {
    expect(grid.getRow("99999").original).toBe(data[99_999]);
    expect(grid.getRowModel().rowsById["100000"]).toBeUndefined();
    expect(grid.getRowModel().rowsById["099999"]).toBeUndefined();
  });
  expect(created).toBe(1);
  expect(timing.p95Ms).toBeLessThan(10);
  await reportScenario("virtual-row-default-id", { ...timing, sourceRows: data.length, created });
});

test("a discarded row can be resolved by ID after scrolling through the cache window", () => {
  const grid = createTable({
    data,
    columns: [{ accessorKey: "value" }],
    getRowId: (row) => row.id,
    getCoreRowModel: getVirtualRowModel(32),
    state: {},
    onStateChange: () => undefined,
    renderFallbackValue: null,
  });
  const model = grid.getRowModel();
  const original = model.rows[0];
  for (let index = 1; index <= 64; index++) model.rows[index].getValue("value");
  const restored = grid.getRow("row-0");
  expect(restored).not.toBe(original);
  expect(restored.original).toBe(original.original);
  expect(restored.getValue("value")).toBe(0);
  expect(model.rowsById["row-99999"].original).toBe(data[99_999]);
});
