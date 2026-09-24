import { describe, expect, test } from "bun:test";
import {
  createAppQueryClient,
  invalidateTableReads,
  isConnectionQuery,
  sameTableSource,
} from "../src/lib/query-client";

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

  test("placeholder rows do not cross transaction sessions", () => {
    const original = [
      "rows",
      "a",
      "db",
      "public",
      "users",
      "",
      "",
      false,
      false,
      0,
      100,
      true,
      "tx-1",
    ];
    expect(sameTableSource(original, [...original.slice(0, 12), "tx-2"])).toBe(false);
  });

  test("SQL execution refreshes table rows and counts for its database", async () => {
    const client = createAppQueryClient();
    const selected = ["rows", "a", "db", "public", "users"];
    const selectedCount = ["count", "a", "db", "public", "users"];
    const other = ["rows", "a", "other", "public", "users"];
    const otherConnection = ["rows", "b", "db", "public", "users"];
    for (const key of [selected, selectedCount, other, otherConnection]) {
      client.setQueryData(key, []);
    }
    await invalidateTableReads(client, "a", "db");
    expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
    expect(client.getQueryState(selectedCount)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherConnection)?.isInvalidated).toBe(false);
    client.clear();
  });

  test("never repeats timed out, cancelled or lock-blocked queries", () => {
    const retry = createAppQueryClient().getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: unknown,
    ) => boolean;
    for (const message of [
      "Query-Timeout nach 30 Sekunden: Abfrage vom Server abgebrochen.",
      "FEHLER: storniere Anfrage wegen Zeitüberschreitung der Anweisung\nSQLSTATE 57014",
      "ERROR: canceling statement due to lock timeout\nSQLSTATE 55P03",
      "Abbruch nicht bestätigt: io error",
    ])
      expect(retry(0, new Error(message))).toBe(false);
    expect(retry(0, new Error("Datenbankfehler: connection reset"))).toBe(true);
    expect(retry(3, new Error("Datenbankfehler: connection reset"))).toBe(false);
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
