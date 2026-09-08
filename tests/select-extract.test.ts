import { describe, expect, test } from "bun:test";
import {
  parameterizeVariables,
  selectAtOffset,
  selectForResults,
  stripInto,
} from "../src/lib/select-extract";
import { EMPTY_REGISTRY } from "../src/lib/sql-intellisense";

const registry = {
  ...EMPTY_REGISTRY,
  tables: [{ schema: "APP", name: "TRADER" }],
  columns: ["REF_MAND", "REF_SUB_MAND", "NAME"].map((name) => ({
    schema: "APP",
    table: "TRADER",
    name,
    data_type: "VARCHAR2",
  })),
} as typeof EMPTY_REGISTRY;

const body = `begin
  vr_auf := null;
  select * into vr_trader from TRADER where REF_MAND=vr_auf.REF_MAND and ((REF_SUB_MAND is null and vr_auf.REF_SUB_MAND is null) or (REF_SUB_MAND=vr_auf.REF_SUB_MAND)) and NAME=pPartner;
  for r in (select name from TRADER t where t.ref_mand = pMand) loop null; end loop;
end;`;

describe("selectAtOffset", () => {
  test("liefert das umschließende Statement zwischen Semikolons", () => {
    const sql = selectAtOffset(body, body.indexOf("TRADER"));
    expect(sql?.startsWith("select * into vr_trader")).toBe(true);
    expect(sql?.endsWith("NAME=pPartner")).toBe(true);
  });

  test("schneidet Klammer-Subselects in Cursor-Schleifen ab", () => {
    const sql = selectAtOffset(body, body.lastIndexOf("TRADER"));
    expect(sql).toBe("select name from TRADER t where t.ref_mand = pMand");
  });

  test("gibt null zurück außerhalb eines Selects", () => {
    expect(selectAtOffset(body, body.indexOf("vr_auf := null"))).toBeNull();
  });
});

describe("stripInto", () => {
  test("entfernt INTO und BULK COLLECT INTO", () => {
    expect(stripInto("select a, b into x, y from t")).toBe("select a, b from t");
    expect(stripInto("select a bulk collect into l_tab from t")).toBe("select a from t");
  });
});

describe("parameterizeVariables", () => {
  test("ersetzt PL/SQL-Variablen durch Bind-Parameter", () => {
    const out = parameterizeVariables(
      "select * from TRADER where REF_MAND=vr_auf.REF_MAND and NAME=pPartner and count(*) > 0 and NAME='x'",
      registry,
    );
    expect(out).toBe(
      "select * from TRADER where REF_MAND=:vr_auf_REF_MAND and NAME=:pPartner and count(*) > 0 and NAME='x'",
    );
  });

  test("lässt Alias-Spalten und Bindings unangetastet", () => {
    const out = parameterizeVariables(
      "select t.name from TRADER t where t.ref_mand = :m",
      registry,
    );
    expect(out).toBe("select t.name from TRADER t where t.ref_mand = :m");
  });

  test("ändert nichts ohne bekannte Spalten", () => {
    const sql = "select * from X where a = b";
    expect(parameterizeVariables(sql, EMPTY_REGISTRY)).toBe(sql);
  });
});

test("selectForResults kombiniert alles", () => {
  const out = selectForResults(body, body.indexOf("TRADER"), registry);
  expect(out).toBe(
    "select * from TRADER where REF_MAND=:vr_auf_REF_MAND and ((REF_SUB_MAND is null and :vr_auf_REF_SUB_MAND is null) or (REF_SUB_MAND=:vr_auf_REF_SUB_MAND)) and NAME=:pPartner",
  );
});
