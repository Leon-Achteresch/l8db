import { expect, test } from "bun:test";

import { packageOid, parsePlsqlMembers } from "../src/lib/plsql";

test("packageOid uses the Oracle adapter separator", () => {
  expect(packageOid("HR", "PKG", "body").split("")).toEqual(["HR", "PKG", "PACKAGE BODY"]);
});

test("parsePlsqlMembers finds subprograms with line numbers, prefers body over forward declaration", () => {
  const src = [
    "PACKAGE BODY shop_pkg AS",
    "  FUNCTION total_price(p_id NUMBER) RETURN NUMBER;",
    '  PROCEDURE "Add_Item"(p_name VARCHAR2) IS',
    "  BEGIN NULL; END;",
    "  function total_price(p_id NUMBER) RETURN NUMBER IS",
    "  BEGIN RETURN 0; END;",
    "END shop_pkg;",
  ].join("\n");
  expect(parsePlsqlMembers(src)).toEqual([
    { kind: "FUNCTION", name: "TOTAL_PRICE", line: 5 },
    { kind: "PROCEDURE", name: "ADD_ITEM", line: 3 },
  ]);
});

test("parsePlsqlMembers keeps spec declarations and does not treat is_valid as a body", () => {
  const src = [
    "PACKAGE shop_pkg AS",
    "  FUNCTION is_valid(p_id NUMBER) RETURN BOOLEAN;",
    "  PROCEDURE add_item(p_name VARCHAR2);",
    "END shop_pkg;",
  ].join("\n");
  expect(parsePlsqlMembers(src)).toEqual([
    { kind: "FUNCTION", name: "IS_VALID", line: 2 },
    { kind: "PROCEDURE", name: "ADD_ITEM", line: 3 },
  ]);
});
