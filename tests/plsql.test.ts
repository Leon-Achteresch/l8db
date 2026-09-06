import { expect, test } from "bun:test";

import { packageOid, parsePlsqlMembers } from "../src/lib/plsql";

test("packageOid uses the Oracle adapter separator", () => {
  expect(packageOid("HR", "PKG", "body").split("")).toEqual(["HR", "PKG", "PACKAGE BODY"]);
});

test("parsePlsqlMembers finds subprograms with line numbers, ignores forward-declaration duplicates", () => {
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
    { kind: "FUNCTION", name: "TOTAL_PRICE", line: 2 },
    { kind: "PROCEDURE", name: "ADD_ITEM", line: 3 },
  ]);
});
