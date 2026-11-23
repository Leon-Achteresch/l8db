import { describe, expect, test } from "bun:test";
import { destructiveStatements, writesData } from "../src/lib/sql-safety";
import cases from "./fixtures/write-detection-cases.json";

const reasons = (sql: string, dialect: string, strict = false) =>
  destructiveStatements(sql, dialect, { strict }).map((entry) => entry.reason);

describe("write detection per family", () => {
  for (const [dialect, { writes, reads }] of Object.entries(cases))
    test(`${dialect}: shared cases match the Rust CLI detection`, () => {
      for (const sql of writes) expect([sql, writesData(sql, dialect)]).toEqual([sql, true]);
      for (const sql of reads) expect([sql, writesData(sql, dialect)]).toEqual([sql, false]);
    });

  test("Redis reads stay reads and dangerous commands need confirmation", () => {
    for (const sql of ["ZCOUNT z 0 10", "PFCOUNT hll", "JSON.GET doc", "GEOPOS g a", "KEYS user:*"])
      expect(writesData(sql, "redis")).toBe(false);
    for (const sql of ["SHUTDOWN", "CONFIG SET maxmemory 1mb", "SCRIPT FLUSH", "SWAPDB 0 1"])
      expect(writesData(sql, "redis")).toBe(true);
    expect(reasons("SHUTDOWN NOSAVE", "redis")).toEqual(["Server beenden"]);
    expect(reasons("config set maxmemory 1mb", "redis")).toEqual(["Serverkonfiguration ändern"]);
    expect(reasons("SCRIPT FLUSH", "redis")).toEqual(["Skripte löschen"]);
    expect(reasons("SWAPDB 0 1", "redis")).toEqual(["Datenbanken tauschen"]);
    expect(reasons("RENAME a b", "redis")).toHaveLength(1);
    expect(reasons("RESTORE k 0 payload REPLACE", "redis")).toEqual(["Schlüssel überschreiben"]);
    expect(reasons("RESTORE k 0 payload", "redis")).toEqual([]);
    expect(reasons("CONFIG GET maxmemory", "redis")).toEqual([]);
    expect(reasons("GET a", "redis")).toEqual([]);
    for (const sql of ['"FLUSHALL"', "'flushdb'", 'FLUSH"ALL"', '"\\x46LUSHALL"', '  "flushall"  '])
      expect([sql, reasons(sql, "redis")]).toEqual([sql, ["Alle Schlüssel löschen"]]);
    expect(reasons('"DEL" key', "redis", true)).toEqual(["Schlüssel löschen"]);
    expect(reasons("'unlink' key", "redis", true)).toEqual(["Schlüssel löschen"]);
    expect(reasons('"CONFIG" "SET" maxmemory 1mb', "redis")).toEqual([
      "Serverkonfiguration ändern",
    ]);
    expect(reasons('RESTORE k 0 payload "REPLACE"', "redis")).toEqual(["Schlüssel überschreiben"]);
    expect(writesData('"GET" a', "redis")).toBe(false);
    expect(writesData('"FLUSHALL"', "redis")).toBe(true);
  });

  test("Elasticsearch Dev-Tools reads are reads, writes and deletes are not", () => {
    for (const sql of [
      'GET logs/_search\n{"query":{"match_all":{}}}',
      "POST logs/_count",
      "HEAD logs",
      "GET a/_search\nGET b/_search",
      "SELECT * FROM logs",
      'POST _plugins/_sql\n{"query":"SELECT 1"}',
      'POST logs/_search {"size": 1}',
    ])
      expect(writesData(sql, "elasticsearch")).toBe(false);
    for (const sql of [
      'PUT logs/_doc/1\n{"a":1}',
      "POST logs/_doc",
      "DELETE logs",
      "POST logs/_delete_by_query",
      "POST logs/../_doc",
      "GET a/_search\nDELETE b",
      "POST _plugins/_security/api/internalusers",
      "POST _plugins/_ppl",
    ])
      expect(writesData(sql, "elasticsearch")).toBe(true);
    expect(reasons("DELETE logs", "elasticsearch")).toEqual(["Index löschen"]);
    expect(reasons('POST logs/_delete_by_query\n{"query":{}}', "elasticsearch")).toEqual([
      "Dokumente per Query löschen",
    ]);
    expect(reasons("DELETE logs/_doc/1", "elasticsearch")).toEqual([]);
    expect(reasons("DELETE logs/_doc/1", "elasticsearch", true)).toEqual(["Dokument löschen"]);
  });

  test("warehouse families block writes on read-only connections", () => {
    for (const dialect of ["bigquery", "snowflake", "athena", "sqlite_http"]) {
      expect(writesData("SELECT * FROM t", dialect)).toBe(false);
      for (const sql of ["DROP TABLE t", "DELETE FROM t WHERE n = 1", "INSERT INTO t VALUES (1)"])
        expect(writesData(sql, dialect)).toBe(true);
    }
    expect(writesData("UNLOAD (SELECT * FROM t) TO 's3://b/x'", "athena")).toBe(true);
    expect(writesData("PUT file:///tmp/a.csv @stage", "snowflake")).toBe(true);
    expect(writesData("REMOVE @stage/a.csv", "snowflake")).toBe(true);
  });

  test("ClickHouse ALTER mutations ask before deleting rows", () => {
    expect(reasons("ALTER TABLE t DELETE WHERE id = 1", "clickhouse")).toEqual([
      "Mutation: Zeilen löschen",
    ]);
    expect(reasons("ALTER TABLE t UPDATE a = 1 WHERE id = 1", "clickhouse")).toEqual([]);
    expect(reasons("ALTER TABLE t UPDATE a = 1 WHERE id = 1", "clickhouse", true)).toEqual([
      "Mutation: Zeilen ändern",
    ]);
  });
});
