import { expect, test } from "bun:test";

import {
  impactCallMarkers,
  lintPlsql,
  locateText,
  plsqlBlockPairs,
  sqlErrorMarkers,
} from "../src/lib/sql-diagnostics";

const at = (text: string, marker: { start: number; end: number }) =>
  text.slice(marker.start, marker.end);

test("Oracle position points to the offending token after leading comments", () => {
  const sql = "-- note\nSELECT foo FROM dual";
  const [marker] = sqlErrorMarkers(
    'Oracle: ORA-00904: "FOO": invalid identifier\nPosition: 8',
    sql,
    0,
    "oracle",
  );
  expect(at(sql, marker)).toBe("foo");
  expect(marker.severity).toBe("error");
});

test("ORA-06550 line/column and compile output become markers with details", () => {
  const sql = "BEGIN\n  foo;\n  x := 1;\nEND;";
  const markers = sqlErrorMarkers(
    "Oracle: ORA-06550: line 2, column 3:\nPLS-00201: identifier 'FOO' must be declared\nORA-06550: line 2, column 3:\nPL/SQL: Statement ignored",
    sql,
    10,
    "oracle",
  );
  expect(markers.map((m) => m.message)).toEqual([
    "PLS-00201: identifier 'FOO' must be declared",
    "PL/SQL: Statement ignored",
  ]);
  expect(markers[0].start).toBe(10 + sql.indexOf("foo"));
  const compiled = sqlErrorMarkers(
    "Zeile 3, Spalte 3: PLW-06002: Unreachable code",
    sql,
    0,
    "oracle",
  );
  expect(at(sql, compiled[0])).toBe("x");
  expect(compiled[0].severity).toBe("warning");
});

test("Postgres position and MySQL line fall back correctly", () => {
  const sql = "SELECT 1;\nSELEC 2";
  expect(at(sql, sqlErrorMarkers("ERROR: syntax error\nPosition: 11", sql, 0, "postgres")[0])).toBe(
    "SELEC",
  );
  expect(at(sql, sqlErrorMarkers("MySQL 1064: near 'SELEC 2' at line 2", sql, 0, "mysql")[0])).toBe(
    "SELEC 2",
  );
  expect(sqlErrorMarkers("connection refused", sql)).toEqual([]);
});

test("caller impact markers land on the changed subprogram", () => {
  const sql = "CREATE OR REPLACE FUNCTION add_one RETURN NUMBER IS BEGIN RETURN 1; END;";
  const [marker] = impactCallMarkers(
    "Aufrufer HR.CALL_IT (PROCEDURE): PLS-00306: wrong number or types of arguments in call to 'ADD_ONE'",
    sql,
  );
  expect(at(sql, marker)).toBe("add_one");
  expect(marker.message).toContain("HR.CALL_IT");
  expect(marker.severity).toBe("error");
});

test("locateText picks the occurrence nearest to the cursor", () => {
  expect(locateText("SELECT 1; SELECT 1;", "SELECT 1", 12)).toBe(10);
});

test("valid PL/SQL produces no findings", () => {
  const body = `CREATE OR REPLACE PACKAGE BODY pk AS
  FUNCTION f(p IN NUMBER := NULL) RETURN NUMBER IS
    v NUMBER := CASE WHEN p IS NULL THEN 0 ELSE p END;
  BEGIN
    FOR r IN (SELECT id FROM t WHERE name = 'end if') LOOP
      IF r.id > v THEN
        UPDATE t SET name = NULL WHERE id = r.id;
      ELSIF r.id = 0 THEN
        NULL;
      END IF;
    END LOOP;
    CASE v WHEN 1 THEN NULL; ELSE NULL; END CASE;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RAISE;
  END f;
  PROCEDURE p IS
  BEGIN
    NULL;
  END;
BEGIN
  NULL;
END pk;
/
DECLARE
  PROCEDURE local_p IS BEGIN NULL; END;
BEGIN
  local_p;
END;
/
CREATE OR REPLACE PACKAGE spec AS
  PROCEDURE p(x NUMBER);
  FUNCTION f RETURN NUMBER;
END spec;
/
CREATE OR REPLACE TRIGGER trg FOR INSERT ON t COMPOUND TRIGGER
  BEFORE STATEMENT IS BEGIN NULL; END BEFORE STATEMENT;
END trg;
/`;
  expect(lintPlsql(body)).toEqual([]);
});

test("PL/SQL lint reports structural errors and warnings", () => {
  const src = `BEGIN
  IF x = NULL THEN
    y := (1 + 2;
  ELSEIF z THEN
    NULL;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN NULL;
END
/
SELECT 'open FROM dual;`;
  const findings = lintPlsql(src).map((f) => [f.severity, f.message, at(src, f)]);
  expect(findings).toEqual([
    ["error", "IF ohne END IF", "IF"],
    ["warning", 'Vergleich "= NULL" ist nie wahr – IS NULL verwenden', "="],
    ["error", "Klammer wird nicht geschlossen", "("],
    ["error", "ELSEIF gibt es in PL/SQL nicht – ELSIF verwenden", "ELSEIF"],
    ["error", "END LOOP ohne passendes LOOP", "END"],
    ["warning", "WHEN OTHERS THEN NULL verschluckt alle Fehler", "NULL"],
    ["error", "Semikolon nach END fehlt", "END"],
    ["error", "Zeichenkette wird nicht geschlossen", "'open FROM dual;"],
  ]);
});

test("plsqlBlockPairs: END springt zum passenden BEGIN/IF", () => {
  const src = "BEGIN\n  IF x THEN\n    NULL;\n  END IF;\nEND;";
  const pairs = plsqlBlockPairs(src).map((p) => [at(src, p.close), at(src, p.open)]);
  expect(pairs).toEqual([
    ["END IF", "IF"],
    ["END", "BEGIN"],
  ]);
});
