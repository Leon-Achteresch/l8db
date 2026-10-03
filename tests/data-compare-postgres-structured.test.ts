import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";

import { buildSyncScript, compareTableData } from "../src/lib/data-compare";

const keyColumns = ["id"];
const compareColumns = ["tags", "grid", "addr", "addrs", "docs", "attrs", "doc"];
const columnTypes = {
  id: "integer",
  tags: "text[]",
  grid: "integer[]",
  addr: "app.address",
  addrs: "app.address[]",
  docs: "jsonb[]",
  attrs: "hstore",
  doc: "jsonb",
};

const source = {
  id: 1,
  tags: ["a,b", 'say "hi"', "back\\slash", null, "it's"],
  grid: [
    [1, 2],
    [3, 4],
  ],
  addr: { zip: "12345", street: "Main St, 1", geo: [1.5, 2.5] },
  addrs: [{ zip: "1", street: "x", geo: null }],
  docs: [{ a: 1 }, null],
  attrs: { "k=>1": 'v"1', empty: null },
  doc: { nested: ["x"] },
};

const changed = {
  id: 1,
  tags: ["old"],
  grid: [[0]],
  addr: { zip: "0", street: "old", geo: [] },
  addrs: [],
  docs: [],
  attrs: { a: "b" },
  doc: { nested: [] },
};

function script(right: Record<string, unknown>[]) {
  const rows = compareTableData({ keyColumns, compareColumns, left: [source], right }).rows;
  return buildSyncScript({
    rows,
    direction: "left_to_right",
    target: { schema: "app", table: "dst" },
    keyColumns,
    compareColumns,
    kind: "postgres",
    columnTypes,
  });
}

describe("Postgres-Abgleichskript für strukturierte Werte", () => {
  test("schreibt Arrays und Composites nicht als JSON-Text", () => {
    const sql = script([]).sql;
    expect(sql).not.toContain(`'["a,b"`);
    expect(sql).toContain(
      `(jsonb_populate_record(NULL::"app"."dst", '{"tags":["a,b","say \\"hi\\"","back\\\\slash",null,"it''s"]}'::jsonb))."tags"`,
    );
    expect(sql).toContain(`(jsonb_populate_record(NULL::"app"."dst", '{"addr":`);
    expect(sql).toContain(`'"k=>1"=>"v\\"1", "empty"=>NULL'`);
    expect(sql).toContain(`'{"nested":["x"]}'`);
  });

  test("vergleicht im UPDATE gegen den bisherigen strukturierten Wert", () => {
    const sql = script([changed]).sql;
    expect(sql).toContain(
      `"tags" IS NOT DISTINCT FROM (jsonb_populate_record(NULL::"app"."dst", '{"tags":["old"]}'::jsonb))."tags"`,
    );
    expect(sql).toContain(`"attrs" IS NOT DISTINCT FROM '"a"=>"b"'`);
  });
});

const PG_URL = process.env.L8DB_E2E_PG_URL;

describe.skipIf(!PG_URL)("Postgres-Abgleichskript gegen echte Datenbank", () => {
  const sql = new SQL(PG_URL ?? "");

  beforeAll(async () => {
    await sql.unsafe(`
      DROP SCHEMA IF EXISTS app CASCADE;
      CREATE EXTENSION IF NOT EXISTS hstore;
      CREATE SCHEMA app;
      CREATE TYPE app.address AS (zip text, street text, geo numeric[]);
      CREATE TABLE app.src (id integer PRIMARY KEY, tags text[], grid integer[], addr app.address, addrs app.address[], docs jsonb[], attrs hstore, doc jsonb);
      CREATE TABLE app.dst (LIKE app.src INCLUDING ALL);
    `);
  });

  afterAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS app CASCADE");
    await sql.close();
  });

  const read = async (table: string) =>
    (await sql.unsafe(`SELECT to_jsonb(t) AS row FROM app.${table} t ORDER BY id`)).map(
      (row: { row: unknown }) => (typeof row.row === "string" ? JSON.parse(row.row) : row.row),
    );

  test("überträgt Arrays, Composites, hstore und jsonb verlustfrei", async () => {
    await sql.unsafe(
      `INSERT INTO app.src VALUES (1, ARRAY['a,b', 'say "hi"', 'back\\slash', NULL, 'it''s'], '{{1,2},{3,4}}', ROW('12345', 'Main St, 1', '{1.5,2.5}'), ARRAY[ROW('1', 'x', NULL)::app.address], ARRAY['{"a":1}'::jsonb, NULL], '"k=>1"=>"v\\"1", "empty"=>NULL', '{"nested":["x"]}')`,
    );
    const [left] = await read("src");
    expect(left).toEqual(source);
    await sql.unsafe(script([]).sql);
    expect(await read("dst")).toEqual([left]);
  });

  test("aktualisiert geänderte strukturierte Werte nur bei unverändertem Ziel", async () => {
    await sql.unsafe("DELETE FROM app.dst");
    await sql.unsafe(
      `INSERT INTO app.dst VALUES (1, ARRAY['old'], '{{0}}', ROW('0', 'old', '{}'), '{}', '{}', '"a"=>"b"', '{"nested":[]}')`,
    );
    const [right] = await read("dst");
    expect(right).toEqual(changed);
    const result = await sql.unsafe(script([right]).sql);
    expect(result.count).toBe(1);
    expect(await read("dst")).toEqual([source]);
  });
});
