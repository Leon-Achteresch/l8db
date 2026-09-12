import { expect, test } from "bun:test";
import { createTable, getCoreRowModel } from "@tanstack/react-table";
import { getVirtualRowModel } from "../src/lib/virtual-row-model";

const data = Array.from({ length: 20000 }, (_, id) => ({ id: `row-${id}`, value: id * 2 }));

function table(cacheSize = 512) {
  return createTable({
    data,
    columns: [{ accessorKey: "value" }],
    getRowId: (row) => row.id,
    getCoreRowModel: getVirtualRowModel(cacheSize),
    state: {},
    onStateChange: () => undefined,
    renderFallbackValue: null,
  });
}

test("large flat tables create rows only when accessed and reuse the visible window", () => {
  const grid = table();
  let created = 0;
  grid._features.push({
    createRow: () => {
      created++;
    },
  });
  const model = grid.getRowModel();
  expect(model.rows.length).toBe(20000);
  expect(created).toBe(0);
  const row = model.rows[15000];
  expect(row.index).toBe(15000);
  expect(row.original).toBe(data[15000]);
  expect(row.getValue("value")).toBe(30000);
  expect(model.flatRows[15000]).toBe(row);
  expect(grid.getRow("row-15000")).toBe(row);
  expect(created).toBe(1);
});

test("array traversal and id lookup match the standard flat row model", () => {
  const grid = table();
  grid.setOptions((previous) => ({ ...previous, data: data.slice(0, 12) }));
  const model = grid.getRowModel();
  const standard = getCoreRowModel<(typeof data)[number]>()(grid)();
  expect(model.rows.map((row) => row.id)).toEqual(standard.rows.map((row) => row.id));
  expect([...model.rows].map((row) => row.getValue("value"))).toEqual(
    standard.rows.map((row) => row.getValue("value")),
  );
  expect(model.rows.slice(2, 5).map((row) => row.index)).toEqual([2, 3, 4]);
  expect(model.rows.at(-1)?.id).toBe("row-11");
  expect(Object.keys(model.rowsById)).toEqual(Object.keys(standard.rowsById));
  expect(Object.values(model.rowsById).map((row) => row.id)).toEqual(
    standard.rows.map((row) => row.id),
  );
  expect(Object.keys(model.rows)).toHaveLength(12);
  expect(2 in model.rows).toBe(true);
  expect(12 in model.rows).toBe(false);
  expect(model.rows[12]).toBeUndefined();
});

test("evicted rows can be revisited without losing ids or source values", () => {
  const grid = table(4);
  const rows = grid.getRowModel().rows;
  const first = rows[0];
  for (let index = 1; index < 20; index++) expect(rows[index].index).toBe(index);
  expect(rows[0]).not.toBe(first);
  expect(rows[0].id).toBe(first.id);
  expect(rows[0].original).toBe(first.original);
  expect(rows[0].getValue("value")).toBe(first.getValue("value"));
});

test("replacing query data invalidates all cached row values", () => {
  const grid = table();
  const old = grid.getRowModel().rows[0];
  expect(old.getValue("value")).toBe(0);
  grid.setOptions((previous) => ({ ...previous, data: [{ id: "row-0", value: 99 }] }));
  const next = grid.getRowModel();
  expect(next.rows.length).toBe(1);
  expect(next.rows[0]).not.toBe(old);
  expect(next.rows[0].getValue("value")).toBe(99);
  expect(next.rowsById["row-0"]).toBe(next.rows[0]);
  expect(next.rowsById["row-1"]).toBeUndefined();
});
