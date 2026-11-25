import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { previousPageBoundary, type RowsQueryKey } from "../src/lib/queries/page-boundary";

test("forward navigation reuses only the fresh adjacent page in the same view", async () => {
  const client = new QueryClient();
  const key: RowsQueryKey = [
    "rows",
    "conn",
    "db",
    "owner",
    "big",
    "",
    "NAME",
    false,
    false,
    10000,
    100,
    false,
    null,
  ];
  const previous = [...key];
  previous[9] = 9999;
  const metadata = ["columns-detailed", ...key.slice(1, 5)];
  const rows = Array.from({ length: 100 }, (_, i) => ({ ID: 999901 + i, NAME: `row-${i}` }));
  const data = { columns: ["ID", "NAME"], rows };
  const columns = {
    columns: [
      { name: "NAME", is_nullable: false, is_primary_key: false },
      { name: "ID", is_primary_key: true, is_nullable: false },
    ],
  };
  client.setQueryData(metadata, columns);
  client.setQueryData(previous, data);
  const read = () => previousPageBoundary(client, key, "oracle");
  const timing = await measureScenario(() => {
    expect(read()).toEqual({ key: "ID", value: 1_000_000, sortText: "row-99" });
  }, 51);
  expect(client.getQueryCache().getAll()).toHaveLength(2);
  expect(client.isFetching()).toBe(0);
  const change = (index: number, value: RowsQueryKey[number]): RowsQueryKey => {
    const copy: [...RowsQueryKey] = [...key];
    copy[index] = value;
    return copy;
  };
  for (const [col, expected] of [
    ["ID", { key: "ID", value: 1_000_000 }],
    ["NAME", { key: "ID", value: 1_000_000, sortText: "row-99" }],
  ] as const) {
    const variant: [...RowsQueryKey] = [...key];
    variant[6] = col;
    variant[7] = true;
    const neighbor: [...RowsQueryKey] = [...variant];
    neighbor[9]--;
    client.setQueryData(neighbor, data);
    expect(previousPageBoundary(client, variant, "postgres")).toEqual(expected);
    client.removeQueries({ queryKey: neighbor, exact: true });
  }
  for (const [index, value] of [
    [1, "other"],
    [3, "other"],
    [5, "filtered"],
    [8, true],
    [12, "tx"],
  ] as const) {
    expect(previousPageBoundary(client, change(index, value), "oracle")).toBeUndefined();
  }
  client.setQueryData(metadata, {
    columns: columns.columns.map((c) => ({ ...c, is_primary_key: true })),
  });
  expect(read()).toBeUndefined();
  client.setQueryData(metadata, {
    columns: columns.columns.map((c) => ({ ...c, is_nullable: true })),
  });
  expect(read()).toBeUndefined();
  client.setQueryData(metadata, columns);
  client.setQueryData(previous, data, { updatedAt: Date.now() - 31000 });
  expect(read()).toBeUndefined();
  client.setQueryData(previous, data);
  client.setQueryData(key, data);
  expect(read()).toBeUndefined();
  client.removeQueries({ queryKey: key, exact: true });
  await client.invalidateQueries({ queryKey: previous, exact: true });
  expect(read()).toBeUndefined();
  await reportScenario("deep-page-boundary-cache", {
    ...timing,
    rows: 100,
    offset: 1_000_000,
    requests: client.isFetching(),
  });
  expect(timing.p95Ms).toBeLessThan(3);
  client.clear();
});
