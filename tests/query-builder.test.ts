import { describe, expect, test } from "bun:test";

const {
  buildSelectSql,
  compileBuilderCondition,
  emptyBuilderState,
  isBuilderReady,
  joinKey,
  joinLabel,
} = await import("../src/lib/query-builder");

type State = ReturnType<typeof emptyBuilderState>;

function baseState(patch: Partial<State> = {}): State {
  return {
    ...emptyBuilderState("postgres"),
    schema: "public",
    table: "users",
    columns: ["id", "name"],
    limit: null,
    ...patch,
  };
}

describe("buildSelectSql", () => {
  test("liefert leeres SQL ohne Tabelle", () => {
    expect(isBuilderReady(emptyBuilderState("postgres"))).toBe(false);
    expect(buildSelectSql(emptyBuilderState("postgres"))).toBe("");
  });

  test("quotet Identifikatoren und nutzt Stern ohne Spaltenauswahl", () => {
    const sql = buildSelectSql(baseState({ columns: [], table: 'we"ird' }));
    expect(sql).toBe('SELECT *\nFROM "public"."we""ird";');
  });

  test("erzeugt Spaltenliste, WHERE, ORDER BY und LIMIT", () => {
    const sql = buildSelectSql(
      baseState({
        conditions: [
          { id: "1", source: "base", column: "name", operator: "contains", value: "o'x" },
          { id: "2", source: "base", column: "age", operator: "gte", value: "18" },
          { id: "3", source: "base", column: "deleted_at", operator: "isNull", value: "" },
        ],
        orders: [{ id: "o1", source: "base", column: "name", direction: "DESC" }],
        limit: 50,
      }),
    );
    expect(sql).toBe(
      'SELECT "id", "name"\n' +
        'FROM "public"."users"\n' +
        `WHERE "name"::text ILIKE '%o''x%' ESCAPE '!' AND "age" >= 18 AND "deleted_at" IS NULL\n` +
        'ORDER BY "name" DESC\n' +
        "LIMIT 50;",
    );
  });

  test("ignoriert unvollständige Bedingungen und Sortierungen", () => {
    const sql = buildSelectSql(
      baseState({
        conditions: [
          { id: "1", source: "base", column: "name", operator: "eq", value: "" },
          { id: "2", source: "join", column: "x", operator: "eq", value: "1" },
          { id: "3", source: "base", column: "", operator: "eq", value: "1" },
        ],
        orders: [{ id: "o1", source: "join", column: "title", direction: "ASC" }],
      }),
    );
    expect(sql).toBe('SELECT "id", "name"\nFROM "public"."users";');
  });

  test("nutzt providerspezifisches Quoting", () => {
    expect(buildSelectSql(baseState({ kind: "mysql", columns: ["id"] }))).toBe(
      "SELECT `id`\nFROM `public`.`users`;",
    );
    expect(buildSelectSql(baseState({ kind: "mssql", columns: ["id"] }))).toBe(
      "SELECT [id]\nFROM [public].[users];",
    );
  });

  test("baut LEFT JOIN mit Aliasen und qualifizierten Spalten", () => {
    const sql = buildSelectSql(
      baseState({
        join: {
          constraintName: "orders_user_id_fkey",
          type: "LEFT",
          schema: "public",
          table: "orders",
          fromColumn: "order_id",
          toColumn: "id",
          columns: ["id", "total"],
        },
        conditions: [{ id: "1", source: "join", column: "total", operator: "gt", value: "10" }],
        orders: [{ id: "o1", source: "join", column: "total", direction: "ASC" }],
        limit: 10,
      }),
    );
    expect(sql).toBe(
      'SELECT t1."id", t1."name", t2."id" AS "orders_id", t2."total" AS "orders_total"\n' +
        'FROM "public"."users" AS t1\n' +
        'LEFT JOIN "public"."orders" AS t2 ON t2."id" = t1."order_id"\n' +
        'WHERE t2."total" > 10\n' +
        'ORDER BY t2."total" ASC\n' +
        "LIMIT 10;",
    );
  });

  test("INNER JOIN ohne Spaltenauswahl selektiert nur Basistabelle", () => {
    const sql = buildSelectSql(
      baseState({
        columns: [],
        join: {
          constraintName: "fk",
          type: "INNER",
          schema: "public",
          table: "orders",
          fromColumn: "order_id",
          toColumn: "id",
          columns: [],
        },
      }),
    );
    expect(sql).toBe(
      "SELECT t1.*\n" +
        'FROM "public"."users" AS t1\n' +
        'INNER JOIN "public"."orders" AS t2 ON t2."id" = t1."order_id";',
    );
  });
});

describe("compileBuilderCondition", () => {
  test("gibt null bei fehlendem Wert zurück", () => {
    expect(compileBuilderCondition('"a"', "eq", "  ")).toBeNull();
    expect(compileBuilderCondition('"a"', "unbekannt", "1")).toBeNull();
  });

  test("escaped Literale und LIKE-Sonderzeichen", () => {
    expect(compileBuilderCondition('"a"', "eq", "o'x")).toBe(`"a" = 'o''x'`);
    expect(compileBuilderCondition('"a"', "startsWith", "50%")).toBe(
      `"a"::text ILIKE '50!%%' ESCAPE '!'`,
    );
    expect(compileBuilderCondition('"a"', "isNotNull", "")).toBe('"a" IS NOT NULL');
  });
});

describe("join identity", () => {
  const rel = {
    constraintName: "fk_a",
    schema: "public",
    table: "orders",
    fromColumn: "order_id",
    toColumn: "id",
  };

  test("Schlüssel unterscheidet gleichnamige Beziehungen", () => {
    expect(joinKey(rel)).not.toBe(joinKey({ ...rel, fromColumn: "other_id" }));
    expect(joinLabel(rel)).toContain("fk_a");
    expect(joinLabel(rel)).toContain("public.orders.id");
  });
});
