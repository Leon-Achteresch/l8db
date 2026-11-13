import { describe, expect, test } from "bun:test";
import { destructiveStatements, writesData } from "../src/lib/sql-safety";

const reasons = (sql: string, dialect: string, strict = false) =>
  destructiveStatements(sql, dialect, { strict }).map((entry) => entry.reason);

describe("write detection per family", () => {
  test("MongoDB aggregate stages $out and $merge write", () => {
    for (const sql of [
      'db.src.aggregate([{$match:{}},{$out:"copy"}])',
      'db.src.aggregate([{$merge:{into:"copy"}}])',
      '{"aggregate":"src","pipeline":[{"$out":"copy"}],"cursor":{}}',
      'db.src.mapReduce(function(){}, function(){}, {out:"copy"})',
    ])
      expect(writesData(sql, "mongodb")).toBe(true);
    for (const sql of [
      'db.src.aggregate([{$match:{status:"open"}},{$count:"n"}])',
      "db.src.mapReduce(function(){}, function(){}, {out:{inline:1}})",
      "db.src.find({})",
    ])
      expect(writesData(sql, "mongodb")).toBe(false);
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
  });

  test("Elasticsearch Dev-Tools reads are reads, writes and deletes are not", () => {
    for (const sql of [
      'GET logs/_search\n{"query":{"match_all":{}}}',
      "POST logs/_count",
      "HEAD logs",
      "GET a/_search\nGET b/_search",
      "SELECT * FROM logs",
    ])
      expect(writesData(sql, "elasticsearch")).toBe(false);
    for (const sql of [
      'PUT logs/_doc/1\n{"a":1}',
      "POST logs/_doc",
      "DELETE logs",
      "POST logs/_delete_by_query",
      "POST logs/../_doc",
      "GET a/_search\nDELETE b",
    ])
      expect(writesData(sql, "elasticsearch")).toBe(true);
    expect(reasons("DELETE logs", "elasticsearch")).toEqual(["Index löschen"]);
    expect(reasons('POST logs/_delete_by_query\n{"query":{}}', "elasticsearch")).toEqual([
      "Dokumente per Query löschen",
    ]);
    expect(reasons("DELETE logs/_doc/1", "elasticsearch")).toEqual([]);
    expect(reasons("DELETE logs/_doc/1", "elasticsearch", true)).toEqual(["Dokument löschen"]);
  });

  test("InfluxDB Flux queries read, to() and line protocol write", () => {
    for (const sql of [
      'from(bucket: "m") |> range(start: -1h)',
      'import "array"\nfrom(bucket: "m") |> range(start: -1h)',
      'SELECT * FROM "cpu"',
      "SHOW MEASUREMENTS",
    ])
      expect(writesData(sql, "influxdb")).toBe(false);
    for (const sql of [
      'from(bucket: "m") |> range(start: -1h) |> to(bucket: "copy")',
      "cpu,host=a usage=1",
      'DELETE FROM "cpu"',
    ])
      expect(writesData(sql, "influxdb")).toBe(true);
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
