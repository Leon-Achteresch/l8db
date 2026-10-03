import { describe, expect, test } from "bun:test";

const { buildProcedureCall, parseProcedureParams } = await import("../src/lib/procedure-params");

describe("procedure calls with OUT parameters", () => {
  test("Postgres passes NULL placeholders for OUT arguments in signature order", () => {
    const params = parseProcedureParams("IN a integer, OUT r text, INOUT c integer");
    expect(buildProcedureCall("postgres", "public", "do_it", params, { a: "7", c: "3" })).toBe(
      'CALL "public"."do_it"(7, NULL, 3)',
    );
  });

  test("Postgres keeps value keys of unnamed inputs aligned when OUT comes first", () => {
    const params = parseProcedureParams("OUT r text, integer, text");
    expect(buildProcedureCall("postgres", "s", "p", params, { p1: "1", p2: "x" })).toBe(
      'CALL "s"."p"(NULL, 1, \'x\')',
    );
  });

  test("Oracle binds OUT and IN OUT arguments to declared variables", () => {
    const params = parseProcedureParams("a NUMBER, OUT r VARCHAR2, INOUT c NUMBER");
    expect(buildProcedureCall("oracle", "HR", "P", params, { a: "1", c: "2" })).toBe(
      'DECLARE v2 VARCHAR2(32767); v3 NUMBER := 2; BEGIN "HR"."P"(1, v2, v3); END;',
    );
  });

  test("Oracle without OUT arguments stays a plain block", () => {
    const params = parseProcedureParams("a text");
    expect(buildProcedureCall("oracle", "HR", "P", params, { a: "x" })).toBe(
      'BEGIN "HR"."P"(\'x\'); END;',
    );
  });
});
