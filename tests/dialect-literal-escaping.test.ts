import { describe, expect, test } from "bun:test";
import { inlineBindValues } from "../src/lib/bind-params";
import type { DatabaseKind } from "../src/lib/db";
import { buildInsertStatements, quoteSqlString, sqlLiteral } from "../src/lib/export";

const injection = "DELETE FROM files WHERE path = :p AND owner = :o";
const injectionValues = {
  p: { type: "text" as const, value: "C:\\tmp\\" },
  o: { type: "text" as const, value: " OR 1=1 -- " },
};

const MYSQL_BACKSLASH = "LEFT('\\\\\\\\', 1)";

function mysqlStringValue(literal: string): string | null {
  const parts: string[] = [];
  let rest = literal;
  const concat = rest.startsWith("CONCAT(") && rest.endsWith(")");
  if (concat) rest = rest.slice(7, -1);
  while (rest.length) {
    if (rest.startsWith(MYSQL_BACKSLASH)) {
      parts.push("\\");
      rest = rest.slice(MYSQL_BACKSLASH.length);
    } else if (rest.startsWith("'")) {
      let i = 1;
      let text = "";
      while (i < rest.length) {
        if (rest[i] === "\\") return null;
        if (rest[i] === "'") {
          if (rest[i + 1] === "'") {
            text += "'";
            i += 2;
            continue;
          }
          break;
        }
        text += rest[i];
        i += 1;
      }
      if (i >= rest.length) return null;
      parts.push(text);
      rest = rest.slice(i + 1);
    } else return null;
    if (!concat) return rest.length ? null : parts.join("");
    if (rest.startsWith(", ")) rest = rest.slice(2);
    else if (rest.length) return null;
  }
  return parts.join("");
}

function backslashStringValue(literal: string): string | null {
  if (!literal.startsWith("'") || !literal.endsWith("'") || literal.length < 2) return null;
  const body = literal.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\") {
      const next = body[i + 1];
      if (next === undefined) return null;
      out += next === "n" ? "\n" : next === "r" ? "\r" : next;
      i += 1;
      continue;
    }
    if (ch === "'") {
      if (body[i + 1] !== "'") return null;
      out += "'";
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function standardStringValue(literal: string): string | null {
  const body = literal.replace(/^N/, "");
  if (!body.startsWith("'") || !body.endsWith("'") || body.length < 2) return null;
  const inner = body.slice(1, -1);
  if (/(^|[^'])'(?!')/.test(inner.replace(/''/g, ""))) return null;
  return inner.split("''").join("'");
}

const samples = [
  "C:\\tmp\\",
  "\\'); DROP TABLE users; -- ",
  "O'Brien",
  "a\\nb",
  "line\nbreak",
  "plain",
  "",
  "\\\\",
  "'",
];

describe("Dialekt-sichere String-Literale", () => {
  test("MySQL-Literale überleben Backslashes in jedem sql_mode", () => {
    for (const sample of samples) {
      const literal = quoteSqlString(sample, "mysql");
      expect(mysqlStringValue(literal)).toBe(sample);
    }
  });

  test("MySQL-Backslashes behalten die Collation der Verbindung", () => {
    const literal = quoteSqlString("C:\\tmp\\a", "mysql");
    expect(literal).not.toContain("USING");
    expect(literal).not.toContain("CHAR(");
    expect(literal).toBe(`CONCAT('C:', ${MYSQL_BACKSLASH}, 'tmp', ${MYSQL_BACKSLASH}, 'a')`);
  });

  for (const kind of ["clickhouse", "snowflake", "bigquery"] as const) {
    test(`${kind}: Backslash-Escapes werden verdoppelt`, () => {
      for (const sample of samples) {
        const literal = quoteSqlString(sample, kind);
        expect(backslashStringValue(literal)).toBe(sample);
      }
    });
  }

  test("BigQuery nutzt keine verdoppelten Hochkommas", () => {
    expect(quoteSqlString("O'Brien", "bigquery")).toBe("'O\\'Brien'");
    expect(quoteSqlString("a\nb\rc", "bigquery")).toBe("'a\\nb\\rc'");
  });

  for (const kind of [
    "postgres",
    "sqlite",
    "mssql",
    "oracle",
    "duckdb",
    "cassandra",
    "athena",
    "odbc",
    "sqlite_http",
  ] as const) {
    test(`${kind}: Standard-Quoting ohne Backslash-Escapes`, () => {
      for (const sample of samples) {
        const literal = quoteSqlString(sample, kind);
        expect(standardStringValue(literal)).toBe(sample);
      }
    });
  }

  test("SQL Server nutzt Unicode-Literale", () => {
    expect(quoteSqlString("Grüße ✓", "mssql")).toBe("N'Grüße ✓'");
  });
});

describe("inlineBindValues nach Dialekt", () => {
  test("MySQL: Backslash am Ende öffnet keine Injection", () => {
    const sql = inlineBindValues(injection, injectionValues, "mysql");
    expect(sql).toBe(
      "DELETE FROM files WHERE path = CONCAT('C:', LEFT('\\\\\\\\', 1), 'tmp', LEFT('\\\\\\\\', 1), '') AND owner = ' OR 1=1 -- '",
    );
  });

  for (const kind of ["clickhouse", "snowflake", "bigquery"] as const) {
    test(`${kind}: Backslash am Ende öffnet keine Injection`, () => {
      const sql = inlineBindValues(injection, injectionValues, kind);
      expect(sql).toContain("path = 'C:\\\\tmp\\\\' AND owner = ' OR 1=1 -- '");
    });
  }

  test("SQL Server: Bool als 1/0, Zeitstempel als String, Text als N-Literal", () => {
    const sql = inlineBindValues(
      "SELECT * FROM t WHERE a = :a AND b = :b AND c = :c AND d = :d",
      {
        a: { type: "bool", value: "true" },
        b: { type: "bool", value: "no" },
        c: { type: "timestamp", value: "2024-01-02T03:04:05Z" },
        d: { type: "text", value: "Grüße" },
      },
      "mssql",
    );
    expect(sql).toBe(
      "SELECT * FROM t WHERE a = 1 AND b = 0 AND c = N'2024-01-02T03:04:05Z' AND d = N'Grüße'",
    );
  });

  const plainTimestampKinds: DatabaseKind[] = [
    "sqlite",
    "sqlite_http",
    "cassandra",
    "odbc",
    "elasticsearch",
    "dynamodb",
  ];
  for (const kind of plainTimestampKinds) {
    test(`${kind}: Zeitstempel ohne TIMESTAMP-Präfix`, () => {
      const sql = inlineBindValues(
        "SELECT :ts",
        { ts: { type: "timestamp", value: "2024-01-02 03:04:05" } },
        kind,
      );
      expect(sql).toBe("SELECT '2024-01-02 03:04:05'");
    });
  }

  for (const kind of ["mysql", "duckdb", "snowflake", "athena"] as const) {
    test(`${kind}: Zeitstempel bleibt typisiertes Literal`, () => {
      const sql = inlineBindValues(
        "SELECT :ts",
        { ts: { type: "timestamp", value: "2024-01-02 03:04:05" } },
        kind,
      );
      expect(sql).toBe("SELECT TIMESTAMP '2024-01-02 03:04:05'");
    });
  }

  test("ungültige Zahlen und Bools werden nicht roh eingesetzt", () => {
    const sql = inlineBindValues(
      "SELECT :a, :b, :c",
      {
        a: { type: "int", value: "1 OR 1=1" },
        b: { type: "numeric", value: "1; DROP TABLE t" },
        c: { type: "bool", value: "1=1" },
      },
      "sqlite",
    );
    expect(sql).toBe("SELECT '1 OR 1=1', '1; DROP TABLE t', '1=1'");
  });
});

describe("INSERT-Export nach Dialekt", () => {
  const row = { id: 1, path: "\\'); DROP TABLE users; -- ", flag: true };

  test("MySQL: Backslash-Quote schließt den String nicht", () => {
    const sql = buildInsertStatements({
      table: "users",
      columns: ["id", "path", "flag"],
      rows: [row],
      kind: "mysql",
    });
    expect(sql).toBe(
      "INSERT INTO `users` (`id`, `path`, `flag`) VALUES (1, CONCAT('', LEFT('\\\\\\\\', 1), '''); DROP TABLE users; -- '), TRUE);\n",
    );
  });

  test("ClickHouse: Backslashes werden verdoppelt", () => {
    const sql = buildInsertStatements({
      table: "users",
      columns: ["path"],
      rows: [{ path: "C:\\new" }],
      kind: "clickhouse",
    });
    expect(sql).toBe('INSERT INTO "users" ("path") VALUES (\'C:\\\\new\');\n');
  });

  test("SQL Server: Bool als 1/0 und N-Literale", () => {
    const sql = buildInsertStatements({
      table: "users",
      columns: ["flag", "off", "name"],
      rows: [{ flag: true, off: false, name: "Grüße" }],
      kind: "mssql",
    });
    expect(sql).toBe("INSERT INTO [users] ([flag], [off], [name]) VALUES (1, 0, N'Grüße');\n");
  });

  test("JSON und Datum nutzen das Dialekt-Quoting", () => {
    expect(sqlLiteral({ p: "a\\b" }, "c", "mysql")).toBe(
      "CONCAT('{\"p\":\"a', LEFT('\\\\\\\\', 1), '', LEFT('\\\\\\\\', 1), 'b\"}')",
    );
    expect(sqlLiteral(new Date("2024-01-02T03:04:05.000Z"), "c", "mssql")).toBe(
      "N'2024-01-02T03:04:05.000Z'",
    );
  });

  test("ohne Kind bleibt das bisherige Format", () => {
    expect(sqlLiteral("C:\\x", "c")).toBe("'C:\\x'");
    expect(sqlLiteral(true, "c")).toBe("TRUE");
  });
});
