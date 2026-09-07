import { describe, expect, test } from "bun:test";
import { createAppQueryClient, isConnectionQuery, sameTableSource } from "../src/lib/query-client";

describe("query cache performance and isolation", () => {
  test("reuses fresh metadata and refetches after an explicit refresh", async () => {
    const client = createAppQueryClient();
    let calls = 0;
    const query = { queryKey: ["tables", "a", "db", "public"], queryFn: async () => ++calls };
    expect(await client.fetchQuery(query)).toBe(1);
    expect(await client.fetchQuery(query)).toBe(1);
    await client.invalidateQueries({
      predicate: (entry) => isConnectionQuery(entry.queryKey, "a"),
    });
    expect(await client.fetchQuery(query)).toBe(2);
    client.clear();
  });

  test("refresh includes search and detailed metadata only for the selected connection", () => {
    for (const root of [
      "all-objects",
      "columns-detailed",
      "column-search",
      "source-search",
      "rows",
      "count",
    ]) {
      expect(isConnectionQuery([root, "a"], "a")).toBe(true);
      expect(isConnectionQuery([root, "b"], "a")).toBe(false);
    }
  });

  test("placeholder rows never cross connections, databases or entity types", () => {
    const original = ["rows", "a", "db", "public", "users", "", "", false, false, 0];
    expect(sameTableSource(original, [...original.slice(0, 9), 1])).toBe(true);
    for (const index of [1, 2, 3, 4, 8]) {
      const next = [...original];
      next[index] = "other";
      expect(sameTableSource(original, next)).toBe(false);
    }
  });

  test("does not give volatile rows or monitoring a metadata freshness window", () => {
    const client = createAppQueryClient();
    expect(client.getQueryDefaults(["tables"]).staleTime).toBe(60_000);
    expect(client.getQueryDefaults(["rows"]).staleTime).toBeUndefined();
    expect(client.getQueryDefaults(["sessions"]).staleTime).toBeUndefined();
    expect(client.getQueryDefaults(["rows"]).gcTime).toBe(60_000);
    client.clear();
  });
});
