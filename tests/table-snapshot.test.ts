import { describe, expect, test } from "bun:test";
import { readTableSnapshot, TABLE_SNAPSHOT_ROW_LIMIT } from "../src/lib/extensions/table-snapshot";

const source = {
  connectionId: "c1",
  database: "db",
  schema: "public",
  table: "nodes",
  filter: "REF_KOPF = 10271",
};

describe("extension table snapshots", () => {
  test("requests every matching row and excludes internal row identifiers", async () => {
    let requested = 0;
    const rows = Array.from({ length: 205 }, (_, index) => ({
      name: `Field${index}`,
      value: index,
      __ctid__: "internal",
    }));
    const result = await readTableSnapshot(source, {
      count: async () => rows.length,
      fetch: async (limit) => {
        requested = limit;
        return { columns: ["name", "value", "__ctid__"], rows };
      },
    });
    expect(requested).toBe(206);
    expect(result.rows).toHaveLength(205);
    expect(result.rows[204]).toEqual({ name: "Field204", value: "204" });
    expect(result.columns).toEqual(["name", "value"]);
    expect(result.filter).toBe(source.filter);
  });

  test("rejects oversized results before loading them", async () => {
    let fetched = false;
    await expect(
      readTableSnapshot(source, {
        count: async () => TABLE_SNAPSHOT_ROW_LIMIT + 1,
        fetch: async () => {
          fetched = true;
          return { columns: [], rows: [] };
        },
      }),
    ).rejects.toThrow("50.000");
    expect(fetched).toBe(false);
  });

  test("rejects truncated, changing, and excessively large data", async () => {
    for (const rows of [[], [{ value: "1" }, { value: "2" }]])
      await expect(
        readTableSnapshot(source, {
          count: async () => 1,
          fetch: async () => ({ columns: ["value"], rows }),
        }),
      ).rejects.toThrow("unvollständig");
    await expect(
      readTableSnapshot(source, {
        count: async () => 1,
        fetch: async () => ({ columns: ["value"], rows: [{ value: "a".repeat(4 * 1024 * 1024) }] }),
      }),
    ).rejects.toThrow("zu groß");
  });

  test("preserves SQL NULL and obtains column metadata for an empty filter", async () => {
    expect(
      (
        await readTableSnapshot(source, {
          count: async () => 1,
          fetch: async () => ({ columns: ["value"], rows: [{ value: null }] }),
        })
      ).rows,
    ).toEqual([{ value: null }]);
    expect(
      (
        await readTableSnapshot(source, {
          count: async () => 0,
          fetch: async () => ({ columns: ["value"], rows: [] }),
        })
      ).columns,
    ).toEqual(["value"]);
  });
});
