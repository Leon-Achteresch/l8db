import { expect, test } from "bun:test";
import {
  matchLoadedObjectComments,
  observeLoadedObjectComments,
  readLoadedObjectComments,
} from "../src/lib/loaded-object-comments";
import {
  createAppQueryClient,
  forgetTableCommentMetadata,
  invalidateAfterSql,
} from "../src/lib/query-client";

const scope = { connectionId: "first", database: "db" };
const tables = (schema: string) => ["tables", "first", "db", schema];
const comment = (schema: string, table: string) => ["table-comment", "first", "db", schema, table];
const columns = (schema: string, table: string) => [
  "columns-detailed",
  "first",
  "db",
  schema,
  table,
];
const setTable = (client: ReturnType<typeof createAppQueryClient>, schema: string, name: string) =>
  client.setQueryData(tables(schema), [{ schema, name }]);

test("uses only recent exact table and column metadata from the current database and schema", () => {
  const client = createAppQueryClient();
  try {
    setTable(client, "public", "orders");
    setTable(client, "billing", "orders");
    client.setQueryData(comment("public", "orders"), "Kundenauftrag\nZahlung");
    client.setQueryData(columns("public", "orders"), {
      columns: [{ name: "owner", comment: "Zahlungsinhaber" }],
      unlogged: true,
    });
    client.setQueryData(comment("billing", "orders"), "Zahlung Geschäftskunden");
    client.setQueryData(comment("public", "unknown"), "Zahlung altes Objekt");
    client.setQueryData(
      ["table-comment", "second", "db", "public", "orders"],
      "Zahlung fremde Verbindung",
    );
    client.setQueryData(
      ["table-comment", "first", "other", "public", "orders"],
      "Zahlung fremde Datenbank",
    );
    const found = readLoadedObjectComments(client, scope);
    const { matches } = matchLoadedObjectComments(found.entries, "  ZAHLUNG ");
    expect(
      matches.map(({ entry, excerpt }) => [entry.schema, entry.table, entry.column, excerpt]),
    ).toEqual([
      ["public", "orders", undefined, "Kundenauftrag Zahlung"],
      ["public", "orders", "owner", "Zahlungsinhaber"],
      ["billing", "orders", undefined, "Zahlung Geschäftskunden"],
    ]);
    expect(new Set(matches.map(({ entry }) => entry.key)).size).toBe(3);
    expect(readLoadedObjectComments(client, { ...scope, schema: "billing" }).entries).toHaveLength(
      1,
    );
    expect(
      readLoadedObjectComments(client, { ...scope, allowedSchemas: ["public"] }).entries,
    ).toHaveLength(2);
    expect(readLoadedObjectComments(client, { ...scope, database: null }).entries).toEqual([]);
    expect(matchLoadedObjectComments(found.entries, "z").matches).toEqual([]);
    expect(matchLoadedObjectComments(found.entries, "z".repeat(161)).matches).toEqual([]);
  } finally {
    client.clear();
  }
});

test("ignores missing, expired and invalidated cache records without a replacement fetch", async () => {
  const client = createAppQueryClient();
  try {
    setTable(client, "public", "orders");
    client.setQueryData(comment("public", "orders"), "expired", {
      updatedAt: Date.now() - 301_000,
    });
    client.setQueryData(columns("public", "orders"), [
      { name: "empty", comment: " \n " },
      { name: "old" },
      { name: "null", comment: null },
      { comment: "missing column name" },
      { name: "valid", comment: "valid" },
    ]);
    expect(readLoadedObjectComments(client, scope).entries.map((entry) => entry.text)).toEqual([
      "valid",
    ]);
    const detailKey = columns("public", "orders");
    await client.invalidateQueries({ queryKey: detailKey, refetchType: "none" });
    expect(readLoadedObjectComments(client, scope).entries).toEqual([]);
    client.setQueryData(detailKey, [{ name: "valid", comment: "updated" }]);
    await client.invalidateQueries({ queryKey: tables("public"), refetchType: "none" });
    expect(readLoadedObjectComments(client, scope).entries).toEqual([]);
    setTable(client, "public", "orders");
    expect(readLoadedObjectComments(client, scope, Date.now() + 301_000).entries).toEqual([]);
  } finally {
    client.clear();
  }
});

test("observes rename, name reuse, and SQL invalidation without retargeting stale comments", async () => {
  const client = createAppQueryClient();
  const store = observeLoadedObjectComments(client, scope);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  try {
    setTable(client, "public", "orders");
    setTable(client, "billing", "orders");
    client.setQueryData(comment("public", "orders"), "current");
    client.setQueryData(comment("billing", "orders"), "another schema");
    client.setQueryData(comment("public", "renamed"), "stale target");
    client.setQueryData(columns("public", "orders"), [
      { name: "owner", comment: "current column" },
    ]);
    expect(store.getSnapshot().entries.map((entry) => entry.text)).toEqual([
      "current",
      "another schema",
      "current column",
    ]);
    client.setQueryData(
      ["table-comment", "second", "db", "public", "orders"],
      "foreign cache update",
    );
    const previous = notifications;
    forgetTableCommentMetadata(client, "first", "db", "public", "orders", "renamed");
    setTable(client, "public", "renamed");
    expect(notifications).toBeGreaterThan(previous);
    expect(store.getSnapshot().entries.map((entry) => entry.text)).toEqual(["another schema"]);
    client.setQueryData(comment("public", "renamed"), "fresh target");
    expect(store.getSnapshot().entries.map((entry) => entry.text)).toEqual([
      "another schema",
      "fresh target",
    ]);
    await invalidateAfterSql(client, "first", "db", "COMMENT ON TABLE public.renamed IS NULL");
    expect(store.getSnapshot().entries).toEqual([]);
    unsubscribe();
    const stopped = notifications;
    client.setQueryData(comment("public", "renamed"), "after unmount");
    expect(notifications).toBe(stopped);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("bounds long comments, excerpts and result counts", () => {
  const client = createAppQueryClient();
  try {
    setTable(client, "public", "orders");
    client.setQueryData(
      comment("public", "orders"),
      `${"x".repeat(2000)} centermarker ${"y".repeat(5000)}lastmarker`,
    );
    client.setQueryData(
      columns("public", "orders"),
      Array.from({ length: 75 }, (_, index) => ({
        name: `field_${index}`,
        comment: `Batch marker ${index}`,
      })),
    );
    const found = readLoadedObjectComments(client, scope);
    expect(found.limited).toBe(true);
    const results = matchLoadedObjectComments(found.entries, "centermarker");
    expect(results.matches[0]?.excerpt).toContain("centermarker");
    expect(results.matches[0]?.excerpt.length).toBeLessThanOrEqual(182);
    expect(matchLoadedObjectComments(found.entries, "lastmarker").matches).toEqual([]);
    const common = matchLoadedObjectComments(found.entries, "batch");
    expect(common.matches).toHaveLength(60);
    expect(common.more).toBe(true);
  } finally {
    client.clear();
  }
});
