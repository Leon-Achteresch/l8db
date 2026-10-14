import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { parsePlsqlMembers } from "../src/lib/plsql";

test("2000-member package body outline for Mod+Shift+G stays within budget", async () => {
  const members = 2000;
  const body = Array.from({ length: members }, (_, index) =>
    [
      index % 2
        ? `  PROCEDURE proc_${index}(p_id NUMBER) IS`
        : `  FUNCTION fn_${index}(p_id NUMBER)`,
      index % 2 ? "  BEGIN" : "    RETURN NUMBER IS",
      "    v_total NUMBER := 0;",
      "  BEGIN",
      "    SELECT COUNT(*) INTO v_total FROM orders WHERE id = p_id;",
      `  END;`,
    ].join("\n"),
  );
  const sql = `CREATE OR REPLACE PACKAGE BODY shop_pkg AS\n${body.join("\n")}\nEND shop_pkg;`;
  let result = parsePlsqlMembers(sql);
  const parse = await measureScenario(() => {
    result = parsePlsqlMembers(sql);
  });
  await reportScenario("plsql-package-members", {
    members: result.length,
    lines: sql.split("\n").length,
    sqlCharacters: sql.length,
    parse,
  });
  expect(result).toHaveLength(members);
  expect(result[1999]).toEqual({ kind: "PROCEDURE", name: "PROC_1999", line: 1999 * 6 + 2 });
  expect(parse.p95Ms).toBeLessThan(30);
});
