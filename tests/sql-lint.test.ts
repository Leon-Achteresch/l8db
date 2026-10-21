import { expect, test } from "bun:test";

import { lintUnknownTables } from "../src/lib/sql-lint";

const tables = [
  { schema: "L8DB", name: "UI_BIG" },
  { schema: "L8DB", name: "ORDERS" },
];

function names(sql: string, oracle = true) {
  return lintUnknownTables(sql, tables, oracle).map((finding) => finding.message);
}

test("unknown tables are flagged, built-in and foreign-schema objects are not", () => {
  expect(names("SELECT 1 FROM dual")).toEqual([]);
  expect(names("SELECT * FROM sys.dual JOIN hr.employees e ON 1 = 1")).toEqual([]);
  expect(names("SELECT * FROM all_objects, user_tables, v$session")).toEqual([]);
  expect(names("SELECT * FROM ui_big JOIN ordrs ON 1 = 1")).toEqual(["Unbekannte Tabelle: ordrs"]);
  expect(names("SELECT * FROM l8db.ordrs")).toEqual(["Unbekannte Tabelle: ordrs"]);
  expect(names("SELECT * FROM l8bd.ui_big")).toEqual([
    "Unbekanntes Schema für diese Tabelle: l8bd",
  ]);
  expect(names("SELECT * FROM user_rols", false)).toEqual(["Unbekannte Tabelle: user_rols"]);
});
