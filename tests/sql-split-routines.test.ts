import { describe, expect, test } from "bun:test";

const { splitSqlStatements, statementAtOffset } = await import("../src/lib/sql-statements");

function texts(sql: string, dialect?: string): string[] {
  const result = splitSqlStatements(sql, dialect);
  expect(result.unterminated).toBe(false);
  return result.statements.map((statement) => statement.text);
}

describe("SQLite triggers", () => {
  const trigger =
    "CREATE TRIGGER tr AFTER INSERT ON a BEGIN INSERT INTO b VALUES (new.id); UPDATE c SET n = CASE WHEN new.id > 1 THEN 1 ELSE 0 END; END;";

  test("keeps the trigger body together", () => {
    expect(texts(`${trigger}\nSELECT 1;`, "sqlite")).toEqual([trigger, "SELECT 1;"]);
  });

  test("temporary triggers and IF NOT EXISTS stay intact", () => {
    const sql =
      "CREATE TEMP TRIGGER IF NOT EXISTS t2 BEFORE DELETE ON a BEGIN DELETE FROM b WHERE id = old.id; END;";
    expect(texts(`${sql} SELECT 2`, "sqlite")).toEqual([sql, "SELECT 2"]);
  });

  test("statement under the cursor returns the whole trigger", () => {
    const sql = `SELECT 0;\n${trigger}\nSELECT 1;`;
    const offset = sql.indexOf("new.id");
    expect(statementAtOffset(sql, offset, "sqlite")?.text).toBe(trigger);
  });
});

describe("MySQL routines", () => {
  const procedure = [
    "CREATE DEFINER=`root`@`localhost` PROCEDURE p(IN x INT)",
    "BEGIN",
    "  DECLARE i INT DEFAULT 0;",
    "  IF x > 0 THEN SET i = 1; END IF;",
    "  CASE x WHEN 1 THEN SET i = 2; ELSE SET i = 3; END CASE;",
    "  lbl: WHILE i < 10 DO SET i = i + 1; END WHILE lbl;",
    "  REPEAT SET i = i - 1; UNTIL i < 0 END REPEAT;",
    "  l2: LOOP LEAVE l2; END LOOP;",
    "  BEGIN SELECT CASE WHEN i > 0 THEN 'a;b' ELSE 'c' END; END;",
    "END;",
  ].join("\n");

  test("keeps procedure bodies with nested blocks together", () => {
    expect(texts(`${procedure}\nCALL p(1);`, "mysql")).toEqual([procedure, "CALL p(1);"]);
  });

  test("triggers, functions and events stay intact", () => {
    const trig =
      "CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x = 1; SET NEW.y = 2; END;";
    const fn =
      "CREATE FUNCTION f() RETURNS INT DETERMINISTIC BEGIN DECLARE r INT; SET r = 1; RETURN r; END;";
    const event =
      "CREATE EVENT e ON SCHEDULE EVERY 1 DAY DO BEGIN DELETE FROM a; DELETE FROM b; END;";
    const simple = "CREATE FUNCTION g() RETURNS INT RETURN 1;";
    expect(texts([trig, fn, event, simple, "SELECT 1;"].join("\n"), "mysql")).toEqual([
      trig,
      fn,
      event,
      simple,
      "SELECT 1;",
    ]);
  });

  test("honours DELIMITER directives and strips them from the statements", () => {
    const sql = [
      "DELIMITER $$",
      "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT '$$'; END$$",
      "CREATE PROCEDURE q() BEGIN SELECT 2; END $$",
      "DELIMITER ;",
      "CALL p();",
      "delimiter //",
      "CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW SET NEW.x = 1//",
      "DELIMITER ;",
      "SELECT 3;",
    ].join("\n");
    expect(texts(sql, "mysql")).toEqual([
      "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT '$$'; END",
      "CREATE PROCEDURE q() BEGIN SELECT 2; END",
      "CALL p();",
      "CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW SET NEW.x = 1",
      "SELECT 3;",
    ]);
  });

  test("tables named like routine keywords and transactions still split", () => {
    expect(
      texts(
        "CREATE TABLE event (id INT, `end` INT);\nBEGIN;\nINSERT INTO event VALUES (1, 2);\nCOMMIT;",
        "mysql",
      ),
    ).toEqual([
      "CREATE TABLE event (id INT, `end` INT);",
      "BEGIN;",
      "INSERT INTO event VALUES (1, 2);",
      "COMMIT;",
    ]);
  });
});

describe("SQL Server batches", () => {
  test("GO separates batches and is not part of any statement", () => {
    const sql = "SELECT 1;\nGO\nSELECT 2\ngo  \nSELECT 3; -- x\n  GO -- done\nSELECT 4";
    expect(texts(sql, "mssql")).toEqual(["SELECT 1;", "SELECT 2", "SELECT 3;", "SELECT 4"]);
  });

  test("procedure, function and trigger bodies run until the end of their batch", () => {
    const proc = "CREATE OR ALTER PROCEDURE dbo.p AS\nBEGIN\n  SET NOCOUNT ON;\n  SELECT 1;\nEND;";
    const fn =
      "ALTER FUNCTION dbo.f() RETURNS INT AS BEGIN DECLARE @r INT; SET @r = 1; RETURN @r; END";
    const trig =
      "CREATE TRIGGER dbo.t ON dbo.a AFTER INSERT AS BEGIN UPDATE dbo.b SET n = 1; DELETE FROM dbo.c; END";
    expect(texts(`${proc}\nGO\n${fn}\nGO\n${trig}\nGO\nSELECT 1;\nSELECT 2;`, "mssql")).toEqual([
      proc,
      fn,
      trig,
      "SELECT 1;",
      "SELECT 2;",
    ]);
  });

  test("GO inside strings, comments, identifiers or longer words is not a separator", () => {
    const sql = "SELECT 'a\nGO\nb', [x\nGO\ny];\n/*\nGO\n*/ SELECT GOTO_x;\nSELECT 1 GO";
    expect(texts(sql, "mssql")).toEqual([
      "SELECT 'a\nGO\nb', [x\nGO\ny];",
      "/*\nGO\n*/ SELECT GOTO_x;",
      "SELECT 1 GO",
    ]);
  });
});

describe("PostgreSQL SQL-standard bodies", () => {
  test("BEGIN ATOMIC bodies stay together", () => {
    const fn =
      "CREATE OR REPLACE FUNCTION f(a int) RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT CASE WHEN a > 0 THEN 1 ELSE 0 END; SELECT 2; END;";
    const proc = "CREATE PROCEDURE p() LANGUAGE sql BEGIN ATOMIC INSERT INTO t VALUES (1); END;";
    expect(texts(`${fn}\n${proc}\nBEGIN;\nSELECT 1;\nEND;`, "postgres")).toEqual([
      fn,
      proc,
      "BEGIN;",
      "SELECT 1;",
      "END;",
    ]);
  });

  test("dollar-quoted functions and triggers keep splitting as before", () => {
    const fn =
      "CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;";
    const trig = "CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW EXECUTE FUNCTION f();";
    expect(texts(`${fn}\n${trig}\nSELECT 1;`, "postgres")).toEqual([fn, trig, "SELECT 1;"]);
  });
});
