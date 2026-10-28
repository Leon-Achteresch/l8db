import { describe, expect, test } from "bun:test";

import {
  buildSyncScript,
  canonicalValue,
  compareTableData,
  DATA_COMPARE_MAX_ROWS,
  DataCompareError,
  type DataDiffRow,
  planDataCompare,
  valuesEqual,
} from "../src/lib/data-compare";

const COLUMNS = [
  { name: "id", data_type: "integer" },
  { name: "name", data_type: "text" },
  { name: "amount", data_type: "numeric" },
];

function plan() {
  return planDataCompare({
    leftColumns: COLUMNS,
    rightColumns: COLUMNS,
    leftKeyColumns: ["id"],
    rightKeyColumns: ["id"],
  });
}

describe("planDataCompare", () => {
  test("liefert Schlüssel- und Vergleichsspalten", () => {
    const result = plan();
    expect(result.error).toBeNull();
    expect(result.keyColumns).toEqual(["id"]);
    expect(result.compareColumns).toEqual(["name", "amount"]);
  });

  test("akzeptiert zusammengesetzte Schlüssel", () => {
    const result = planDataCompare({
      leftColumns: COLUMNS,
      rightColumns: COLUMNS,
      leftKeyColumns: ["id", "name"],
      rightKeyColumns: ["id", "name"],
    });
    expect(result.error).toBeNull();
    expect(result.keyColumns).toEqual(["id", "name"]);
    expect(result.compareColumns).toEqual(["amount"]);
  });

  test("lehnt fehlenden Primärschlüssel ab", () => {
    const result = planDataCompare({
      leftColumns: COLUMNS,
      rightColumns: COLUMNS,
      leftKeyColumns: [],
      rightKeyColumns: ["id"],
    });
    expect(result.error).toContain("Primärschlüssel");
  });

  test("lehnt abweichende Schlüssel ab", () => {
    const result = planDataCompare({
      leftColumns: COLUMNS,
      rightColumns: COLUMNS,
      leftKeyColumns: ["id"],
      rightKeyColumns: ["name"],
    });
    expect(result.error).toContain("unterscheiden sich");
  });

  test("lehnt abweichende Spaltenstruktur ab", () => {
    const result = planDataCompare({
      leftColumns: COLUMNS,
      rightColumns: COLUMNS.slice(0, 2),
      leftKeyColumns: ["id"],
      rightKeyColumns: ["id"],
    });
    expect(result.error).toContain("Spaltenstruktur");
  });

  test("lehnt inkompatible Typen ab", () => {
    const result = planDataCompare({
      leftColumns: COLUMNS,
      rightColumns: [COLUMNS[0], COLUMNS[1], { name: "amount", data_type: "text" }],
      leftKeyColumns: ["id"],
      rightKeyColumns: ["id"],
    });
    expect(result.error).toContain("Inkompatible Spaltentypen");
  });
});

describe("valuesEqual", () => {
  test("behandelt NULL und undefined gleich", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual(null, "")).toBe(false);
    expect(valuesEqual(null, "null")).toBe(false);
  });

  test("hält präzise Zahlen als Text auseinander", () => {
    expect(valuesEqual("1.10", "1.1")).toBe(false);
    expect(valuesEqual("0.30000000000000004", "0.3")).toBe(false);
    expect(canonicalValue("1")).toBe(canonicalValue(1));
  });

  test("vergleicht Objekte unabhängig von der Schlüsselreihenfolge", () => {
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("compareTableData", () => {
  const keyColumns = ["id"];
  const compareColumns = ["name", "amount"];

  test("zählt Kategorien getrennt", () => {
    const result = compareTableData({
      keyColumns,
      compareColumns,
      left: [
        { id: 1, name: "a", amount: "1.00" },
        { id: 2, name: "b", amount: null },
        { id: 3, name: "c", amount: "3.00" },
      ],
      right: [
        { id: 1, name: "a", amount: "1.00" },
        { id: 2, name: "b", amount: "2.00" },
        { id: 4, name: "d", amount: "4.00" },
      ],
    });
    expect(result.counts).toEqual({ only_left: 1, only_right: 1, changed: 1, equal: 1 });
    const changed = result.rows.find((row) => row.category === "changed") as DataDiffRow;
    expect(changed.differences).toEqual([{ column: "amount", left: null, right: "2.00" }]);
    const onlyRight = result.rows.find((row) => row.category === "only_right") as DataDiffRow;
    expect(onlyRight.keyValues).toEqual({ id: 4 });
    expect(onlyRight.left).toBeNull();
  });

  test("erkennt zusammengesetzte Schlüssel", () => {
    const result = compareTableData({
      keyColumns: ["id", "name"],
      compareColumns: ["amount"],
      left: [
        { id: 1, name: "a", amount: "1" },
        { id: 1, name: "b", amount: "2" },
      ],
      right: [
        { id: 1, name: "a", amount: "9" },
        { id: 1, name: "b", amount: "2" },
      ],
    });
    expect(result.counts.changed).toBe(1);
    expect(result.counts.equal).toBe(1);
  });

  test("bricht bei NULL im Schlüssel ab", () => {
    expect(() =>
      compareTableData({
        keyColumns,
        compareColumns,
        left: [{ id: null, name: "a", amount: "1" }],
        right: [],
      }),
    ).toThrow(DataCompareError);
  });

  test("bricht bei doppelten Schlüsseln ab", () => {
    expect(() =>
      compareTableData({
        keyColumns,
        compareColumns,
        left: [
          { id: 1, name: "a", amount: "1" },
          { id: 1, name: "b", amount: "2" },
        ],
        right: [],
      }),
    ).toThrow(/mehrfach/);
  });

  test("bricht bei überschrittenem Limit ab", () => {
    const rows = Array.from({ length: DATA_COMPARE_MAX_ROWS + 1 }, (_, index) => ({
      id: index,
      name: "x",
      amount: "1",
    }));
    expect(() => compareTableData({ keyColumns, compareColumns, left: rows, right: [] })).toThrow(
      /Stichprobe/,
    );
  });
});

describe("buildSyncScript", () => {
  const keyColumns = ["id"];
  const compareColumns = ["name", "amount"];
  const rows = compareTableData({
    keyColumns,
    compareColumns,
    left: [
      { id: 1, name: "a", amount: "1.00" },
      { id: 2, name: "b", amount: null },
      { id: 3, name: "c", amount: "3.00" },
    ],
    right: [
      { id: 1, name: "a", amount: "1.00" },
      { id: 2, name: "b", amount: "2.00" },
      { id: 4, name: "d", amount: "4.00" },
    ],
  }).rows;

  test("erzeugt INSERT und UPDATE für die Richtung links nach rechts", () => {
    const script = buildSyncScript({
      rows,
      direction: "left_to_right",
      target: { schema: "public", table: "kunden" },
      keyColumns,
      compareColumns,
      kind: "postgres",
    });
    expect(script.insertCount).toBe(1);
    expect(script.updateCount).toBe(1);
    expect(script.sql).toContain(
      `INSERT INTO "public"."kunden" ("id", "name", "amount") VALUES (3, 'c', '3.00');`,
    );
    expect(script.sql).toContain(`UPDATE "public"."kunden"`);
    expect(script.sql).toContain(`SET "amount" = NULL`);
    expect(script.sql).toContain(`WHERE "id" = 2`);
    expect(script.sql).toContain(`"amount" IS NOT DISTINCT FROM '2.00'`);
    expect(script.sql).toContain(`"name" IS NOT DISTINCT FROM 'b'`);
    expect(script.keys).toContain("id=2");
  });

  test("dreht die Richtung um", () => {
    const script = buildSyncScript({
      rows,
      direction: "right_to_left",
      target: { schema: null, table: "kunden" },
      keyColumns,
      compareColumns,
      kind: "postgres",
    });
    expect(script.insertCount).toBe(1);
    expect(script.updateCount).toBe(1);
    expect(script.sql).toContain(`INSERT INTO "kunden" ("id", "name", "amount") VALUES (4,`);
    expect(script.sql).toContain(`SET "amount" = '2.00'`);
    expect(script.sql).toContain(`"amount" IS NOT DISTINCT FROM NULL`);
  });

  test("erzeugt nichts für gleiche Zeilen", () => {
    const script = buildSyncScript({
      rows: rows.filter((row) => row.category === "equal"),
      direction: "left_to_right",
      target: { table: "kunden" },
      keyColumns,
      compareColumns,
      kind: "postgres",
    });
    expect(script.sql).toBe("");
    expect(script.insertCount).toBe(0);
    expect(script.updateCount).toBe(0);
  });
});

describe("collision regressions", () => {
  test("frames nested values without delimiter collisions", () => {
    expect(valuesEqual(["a,s:b"], ["a", "b"])).toBe(false);
    expect(valuesEqual({ a: "x,b=s:y" }, { a: "x", b: "y" })).toBe(false);
    const alphabet = [",", "=", "\u0001", "s:", "[", "]", "\\", '"', "😀"];
    for (const a of alphabet) {
      for (const b of alphabet) {
        expect(valuesEqual([`${a},s:${b}`], [a, b])).toBe(false);
        expect(valuesEqual({ a: [a], b: { value: b } }, { b: { value: b }, a: [a] })).toBe(true);
      }
    }
  });
  test("keeps composite keys distinct and emits previously hidden changes", () => {
    const result = compareTableData({
      keyColumns: ["a", "b"],
      compareColumns: ["value"],
      left: [
        { a: "x\u0001s:y", b: "z", value: ["a,s:b"] },
        { a: "x", b: "y\u0001s:z", value: null },
      ],
      right: [{ a: "x\u0001s:y", b: "z", value: ["a", "b"] }],
    });
    expect(result.counts).toEqual({ only_left: 1, only_right: 0, changed: 1, equal: 0 });
  });
});

describe("Sync-Skript je Datenbank", () => {
  const diff = compareTableData({
    keyColumns: ["id"],
    compareColumns: ["name", "data", "flag", "ratio"],
    left: [
      { id: 1, name: "a'b\\c", data: "\\x00ff", flag: true, ratio: 1.5 },
      { id: 2, name: null, data: null, flag: false, ratio: 2 },
    ],
    right: [
      { id: 2, name: "x", data: "\\x01", flag: false, ratio: 2 },
      { id: 3, name: "z", data: null, flag: null, ratio: null },
    ],
  }).rows;
  const columnTypes = {
    id: "int",
    name: "varchar",
    data: "varbinary",
    flag: "bit",
    ratio: "float",
  };
  const build = (kind: "mysql" | "mssql" | "sqlite", includeDeletes = true) =>
    buildSyncScript({
      rows: diff,
      direction: "left_to_right",
      target: { schema: "app", table: "t" },
      keyColumns: ["id"],
      compareColumns: ["name", "data", "flag", "ratio"],
      kind,
      columnTypes,
      includeDeletes,
    });

  test("MySQL maskiert Backslashes und vergleicht NULL-sicher", () => {
    const script = build("mysql");
    expect(script.sql).toContain("DELETE FROM `app`.`t` WHERE `id` = 3;");
    expect(script.sql).toContain(
      "INSERT INTO `app`.`t` (`id`, `name`, `data`, `flag`, `ratio`) VALUES (1, 'a''b\\\\c', X'00FF', 1, 1.5);",
    );
    expect(script.sql).toContain("`name` <=> 'x'");
    expect(script.sql).not.toContain("`ratio` <=>");
    expect(script.deleteCount).toBe(1);
  });

  test("SQL Server nutzt N-Literale, 0x-Binärwerte und IDENTITY_INSERT", () => {
    const script = build("mssql");
    expect(script.sql).toContain("SET IDENTITY_INSERT [app].[t] ON\nINSERT INTO [app].[t]");
    expect(script.sql).toContain("VALUES (1, N'a''b\\c', 0x00FF, 1, 1.5)\nIF");
    expect(script.sql).toContain("[data] = 0x01");
    expect(script.insertCount).toBe(1);
  });

  test("Oracle nutzt HEXTORAW und vergleicht keine LOB-Spalten", () => {
    const script = buildSyncScript({
      rows: diff,
      direction: "left_to_right",
      target: { schema: "APP", table: "T" },
      keyColumns: ["id"],
      compareColumns: ["name", "data", "flag", "ratio"],
      kind: "oracle",
      columnTypes: { ...columnTypes, name: "CLOB", data: "BLOB", ratio: "NUMBER" },
      includeDeletes: true,
    });
    expect(script.sql).toContain("HEXTORAW('00FF')");
    const where = script.sql.slice(script.sql.indexOf(' WHERE "id" = 2'));
    expect(where).not.toContain(`"name"`);
    expect(where).not.toContain(`"data"`);
    expect(where).toContain(`AND "ratio" = 2`);
  });

  test("Oracle teilt lange CLOBs und lehnt nicht schreibbare Werte ab", () => {
    const text = `${"ä".repeat(999)}😀${"b".repeat(1500)}`;
    const rows = compareTableData({
      keyColumns: ["id"],
      compareColumns: ["doc"],
      left: [{ id: 1, doc: text }],
      right: [],
    }).rows;
    const oracle = (doc: string) =>
      buildSyncScript({
        rows,
        direction: "left_to_right",
        target: { schema: "APP", table: "T" },
        keyColumns: ["id"],
        compareColumns: ["doc"],
        kind: "oracle",
        columnTypes: { id: "NUMBER", doc },
      });
    const sql = oracle("CLOB").sql;
    const parts = [...sql.matchAll(/TO_CLOB\('([^']*)'\)/g)].map((match) => match[1]);
    expect(parts.length).toBe(3);
    expect(parts.join("")).toBe(text);
    expect(parts.every((part) => part.length <= 1000)).toBe(true);
    expect(() => oracle("XMLTYPE")).toThrow(/XMLTYPE/);
    expect(() => oracle("MDSYS.SDO_GEOMETRY")).toThrow(/SDO_GEOMETRY/);
    const blob = compareTableData({
      keyColumns: ["id"],
      compareColumns: ["doc"],
      left: [{ id: 1, doc: `\\x${"00".repeat(2001)}` }],
      right: [],
    }).rows;
    expect(() =>
      buildSyncScript({
        rows: blob,
        direction: "left_to_right",
        target: { table: "T" },
        keyColumns: ["id"],
        compareColumns: ["doc"],
        kind: "oracle",
        columnTypes: { id: "NUMBER", doc: "BLOB" },
      }),
    ).toThrow(/2000 Byte/);
  });

  test("Oracle-CLOB-Skript für 200 × 50 000 Zeichen bleibt schnell", () => {
    const doc = "x'y".repeat(16_667).slice(0, 50_000);
    const rows = compareTableData({
      keyColumns: ["id"],
      compareColumns: ["doc"],
      left: Array.from({ length: 200 }, (_, id) => ({ id, doc })),
      right: [],
    }).rows;
    const samples: number[] = [];
    let sql = "";
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      sql = buildSyncScript({
        rows,
        direction: "left_to_right",
        target: { schema: "APP", table: "T" },
        keyColumns: ["id"],
        compareColumns: ["doc"],
        kind: "oracle",
        columnTypes: { id: "NUMBER", doc: "CLOB" },
      }).sql;
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    console.log(
      `oracle clob sync: 200 rows x 50k chars, median ${samples[2].toFixed(1)} ms, max ${samples[4].toFixed(1)} ms, ${(sql.length / 1e6).toFixed(1)} MB script`,
    );
    expect(sql.split("TO_CLOB(").length - 1).toBe(200 * 50);
    expect(samples[2]).toBeLessThan(500);
  });

  test("SQLite nutzt X-Literale und IS", () => {
    const script = build("sqlite", false);
    expect(script.sql).toContain("X'00FF'");
    expect(script.sql).toContain(`"name" IS 'x'`);
    expect(script.sql).not.toContain("DELETE");
    expect(script.deleteCount).toBe(0);
  });
});
