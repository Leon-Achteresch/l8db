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
