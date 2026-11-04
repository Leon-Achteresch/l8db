import { expect, test } from "bun:test";
import { splitSqlStatements } from "../src/lib/sql-statements";
import { includeTarget } from "../src/lib/sql-statements/includes";
import { bindNames, parseSqlPlusCommand } from "../src/lib/sql-statements/sqlplus";
import { sqlplusFeedback } from "../src/lib/sqlplus-output";

test("SQL*Plus commands accept abbreviations, trailing semicolons and every clause", () => {
  expect(parseSqlPlusCommand("set serveroutput on;")).toEqual({
    type: "serveroutput",
    enabled: true,
  });
  expect(parseSqlPlusCommand("SET SERVEROUT ON SIZE UNLIMITED FORMAT WRAPPED")).toEqual({
    type: "serveroutput",
    enabled: true,
  });
  expect(parseSqlPlusCommand("whenever sqlerror exit failure rollback")).toEqual({
    type: "whenever",
    event: "SQLERROR",
    exit: true,
    status: { kind: "code", value: 1, label: "FAILURE" },
    action: "ROLLBACK",
  });
  expect(parseSqlPlusCommand("WHENEVER SQLERROR EXIT SQL.SQLCODE")).toMatchObject({
    status: { kind: "variable", name: "SQL.SQLCODE" },
    action: null,
  });
  expect(parseSqlPlusCommand("WHENEVER OSERROR CONTINUE ROLLBACK")).toMatchObject({
    event: "OSERROR",
    exit: false,
    action: "ROLLBACK",
  });
  expect(parseSqlPlusCommand("exit :rc commit")).toEqual({
    type: "exit",
    status: { kind: "bind", name: "RC" },
    action: "COMMIT",
  });
  expect(parseSqlPlusCommand("quit 4")).toMatchObject({ status: { kind: "code", value: 4 } });
  expect(parseSqlPlusCommand("WHENEVER SQLERROR EXIT FAILURE NONSENSE").type).toBe("invalid");
  expect(parseSqlPlusCommand("set auto on")).toEqual({ type: "set-autocommit", every: 1 });
  expect(parseSqlPlusCommand("SET AUTOCOMMIT 100")).toEqual({ type: "set-autocommit", every: 100 });
  expect(parseSqlPlusCommand("set exitc off")).toEqual({ type: "set-exitcommit", enabled: false });
  expect(parseSqlPlusCommand("set ver off")).toEqual({ type: "set-verify", enabled: false });
  expect(parseSqlPlusCommand("SET CON ~")).toEqual({ type: "set-concat", concat: "~" });
  expect(parseSqlPlusCommand("SET SCAN OFF")).toEqual({ type: "set-define", marker: null });
  expect(parseSqlPlusCommand("set pagesize 0").type).toBe("set-display");
  expect(parseSqlPlusCommand("SET SQLTERMINATOR !").type).toBe("set-unsupported");
  expect(parseSqlPlusCommand("VAR v VARCHAR2(30 CHAR) = 'x y'")).toEqual({
    type: "variable",
    name: "V",
    dataType: "VARCHAR2(30 CHAR)",
    value: "x y",
  });
  expect(parseSqlPlusCommand("print :a b")).toEqual({ type: "print", names: ["A", "B"] });
  expect(parseSqlPlusCommand('SPOOL "C:\\logs\\run 1.log" APPEND')).toEqual({
    type: "spool",
    file: "C:\\logs\\run 1.log",
    mode: "APPEND",
  });
  expect(parseSqlPlusCommand("spool off")).toMatchObject({ type: "spool", file: null });
  expect(parseSqlPlusCommand("COL dt NEW_V today NOPRINT")).toEqual({
    type: "column",
    name: "DT",
    newValue: "TODAY",
    oldValue: null,
  });
  expect(parseSqlPlusCommand('ACC x NUM DEF 5 PROMPT "Wert: " HIDE')).toEqual({
    type: "accept",
    name: "X",
    prompt: "Wert: ",
    defaultValue: "5",
    hide: true,
  });
  expect(parseSqlPlusCommand("timi start load")).toEqual({
    type: "timing",
    action: "START",
    name: "LOAD",
  });
  expect(parseSqlPlusCommand("sho err package body pkg")).toEqual({
    type: "show",
    what: "ERR",
    rest: "package body pkg",
  });
  expect(parseSqlPlusCommand("ho ls").type).toBe("host");
  expect(parseSqlPlusCommand("conn scott/tiger").type).toBe("connect");
  expect(parseSqlPlusCommand("shutdown immediate")).toEqual({
    type: "unsupported",
    name: "SHUTDOWN",
  });
  expect(parseSqlPlusCommand("BRE ON deptno").type).toBe("display");
  expect(parseSqlPlusCommand("prompt Stufe 1 -\n  von 3")).toEqual({
    type: "prompt",
    text: "Stufe 1 von 3",
  });
  expect(parseSqlPlusCommand("PROMPT")).toEqual({ type: "prompt", text: "" });
  expect(parseSqlPlusCommand("DEFINE")).toEqual({ type: "define-show", name: null });
});

test("the splitter recognizes abbreviated commands, continuation lines and keeps SQL intact", () => {
  const split = splitSqlStatements(
    "sho user\nTIMI START x\nPROMPT a -\n  b\nSAVEPOINT s1;\nDELETE FROM t;\nCOMMENT ON TABLE t IS 'x';\nSET TRANSACTION READ ONLY;\nREPLACE_ME;\n",
    "oracle",
  );
  expect(split.commands.map((item) => item.text)).toEqual([
    "sho user",
    "TIMI START x",
    "PROMPT a -\n  b",
  ]);
  expect(split.statements.map((item) => item.text)).toEqual([
    "SAVEPOINT s1;",
    "DELETE FROM t;",
    "COMMENT ON TABLE t IS 'x';",
    "SET TRANSACTION READ ONLY;",
    "REPLACE_ME;",
  ]);
});

test("@ and START pass quoted and plain arguments", () => {
  expect(includeTarget('@child \'a b\' c "d""e"')).toEqual({
    name: "child",
    nested: false,
    args: ["a b", "c", 'd"e'],
  });
  expect(includeTarget("START sub.sql 1;")).toEqual({
    name: "sub.sql",
    nested: false,
    args: ["1"],
  });
});

test("bind names skip literals, comments, assignments and q-quotes", () => {
  expect(
    bindNames(
      "BEGIN :rc := f(:In_1, 'x:y', q'[:no]'); -- :c\n /* :d */ :rc2 := TO_CHAR(SYSDATE, 'HH24:MI'); END;",
    ),
  ).toEqual(["RC", "IN_1", "RC2"]);
});

test("feedback follows SQL*Plus wording in German", () => {
  const empty = { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
  expect(sqlplusFeedback("update t set x = 1", { ...empty, rows_affected: 6 })).toBe(
    "6 Zeilen aktualisiert.",
  );
  expect(sqlplusFeedback("insert into t values (1)", { ...empty, rows_affected: 1 })).toBe(
    "1 Zeile eingefügt.",
  );
  expect(sqlplusFeedback("delete t", { ...empty, rows_affected: 0 })).toBe(
    "Keine Zeilen gelöscht.",
  );
  expect(sqlplusFeedback("-- c\ndeclare n number; begin null; end;", empty)).toBe(
    "PL/SQL-Prozedur erfolgreich abgeschlossen.",
  );
  expect(sqlplusFeedback("CREATE OR REPLACE PACKAGE BODY p AS END;", empty)).toBe(
    "Paketrumpf erstellt.",
  );
  expect(sqlplusFeedback("create unique index i on t(x)", empty)).toBe("Index erstellt.");
  expect(sqlplusFeedback("alter session set nls_language = german", empty)).toBe(
    "Session geändert.",
  );
  expect(sqlplusFeedback("rollback to savepoint a", empty)).toBe(
    "Rollback zum Savepoint durchgeführt.",
  );
  expect(sqlplusFeedback("select 1 from dual", { ...empty, columns: ["1"], rows: [] })).toBe(
    "Keine Zeilen ausgewählt.",
  );
});
