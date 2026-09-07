import { describe, expect, test } from "bun:test";

import {
  buildProcedureCall,
  formatParamValue,
  parseProcedureParams,
  splitTopLevel,
} from "../src/lib/procedure-params";

describe("parseProcedureParams", () => {
  test("liefert leere Liste ohne Argumente", () => {
    expect(parseProcedureParams("")).toEqual([]);
    expect(parseProcedureParams("   ")).toEqual([]);
  });

  test("liest Name, Typ und Modus", () => {
    expect(parseProcedureParams("a integer, INOUT b text")).toEqual([
      { name: "a", type: "integer", mode: "IN" },
      { name: "b", type: "text", mode: "INOUT" },
    ]);
  });

  test("erkennt namenlose und mehrteilige Typen", () => {
    expect(parseProcedureParams("integer, c character varying")).toEqual([
      { name: "", type: "integer", mode: "IN" },
      { name: "c", type: "character varying", mode: "IN" },
    ]);
  });

  test("trennt nur auf oberster Ebene", () => {
    expect(splitTopLevel("a numeric(10,2), b text")).toEqual(["a numeric(10,2)", "b text"]);
  });
});

describe("formatParamValue", () => {
  test("mappt Werte typgerecht", () => {
    expect(formatParamValue("integer", "42")).toBe("42");
    expect(formatParamValue("text", "o'brien")).toBe("'o''brien'");
    expect(formatParamValue("boolean", "yes")).toBe("true");
    expect(formatParamValue("text", "")).toBe("NULL");
  });
});

describe("buildProcedureCall", () => {
  test("baut CALL für Postgres ohne OUT-Parameter", () => {
    const params = parseProcedureParams("a integer, OUT r text");
    expect(buildProcedureCall("postgres", "public", "do_it", params, { a: "7" })).toBe(
      'CALL "public"."do_it"(7)',
    );
  });

  test("baut anonymen Block für Oracle", () => {
    const params = parseProcedureParams("a text");
    expect(buildProcedureCall("oracle", "HR", "P", params, { a: "x" })).toBe(
      'BEGIN "HR"."P"(\'x\'); END;',
    );
  });
});
