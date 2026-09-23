import { describe, expect, test } from "bun:test";

import type { QueryResult } from "../src/lib/db";
import {
  loadQueryStats,
  parseQueryStats,
  QUERY_STATS_DEFAULT_LIMIT,
  queryStatsHint,
  queryStatsSource,
  queryStatsSql,
} from "../src/lib/query-stats";
import {
  buildSavedWorkload,
  buildSavedWorkloadResult,
  compareWorkloadResults,
  detectPlaceholders,
  numberPlaceholders,
  parseWorkloadFile,
  parseWorkloadResultFile,
  runWorkload,
  serializeWorkload,
  skipReason,
  statementsFromStats,
  WORKLOAD_MAX_STATEMENTS,
  type WorkloadStatement,
} from "../src/lib/workload";

const result = (rows: Record<string, unknown>[]): QueryResult => ({
  columns: rows[0] ? Object.keys(rows[0]) : [],
  rows,
  rows_affected: null,
  execution_time_ms: 1,
});

const context = { connectionName: "prod", databaseKind: "postgres", database: "app" };

describe("Statement-Statistik", () => {
  test("liefert SQL für alle unterstützten Familien und null für andere", () => {
    for (const kind of ["postgres", "mysql", "mssql", "clickhouse", "oracle"] as const) {
      const sql = queryStatsSql(kind, 25);
      expect(sql).not.toBeNull();
      expect(sql).toContain("query");
      expect(queryStatsSource(kind)).not.toBeNull();
    }
    expect(queryStatsSql("sqlite", 10)).toBeNull();
    expect(queryStatsSql("mongodb", 10)).toBeNull();
    expect(queryStatsSource("redis")).toBeNull();
  });

  test("begrenzt das Limit hart", () => {
    expect(queryStatsSql("postgres", 99999)).toContain("LIMIT 500");
    expect(queryStatsSql("postgres", -3)).toContain("LIMIT 1");
    expect(queryStatsSql("postgres", Number.NaN)).toContain(`LIMIT ${QUERY_STATS_DEFAULT_LIMIT}`);
    expect(queryStatsSql("mssql", 7)).toContain("TOP (7)");
    expect(queryStatsSql("oracle", 7)).toContain("ROWNUM <= 7");
  });

  test("MySQL-Fallback ohne QUERY_SAMPLE_TEXT", () => {
    expect(queryStatsSql("mysql", 5)).toContain("QUERY_SAMPLE_TEXT");
    expect(queryStatsSql("mysql", 5, true)).not.toContain("QUERY_SAMPLE_TEXT");
  });

  test("parst Zahlen aus Text und ignoriert Groß-/Kleinschreibung der Spalten", () => {
    const entries = parseQueryStats(
      result([
        { QUERY: " select 1 ", CALLS: "12", TOTAL_MS: "30.5", MEAN_MS: 2.5, MAX_MS: null, ROWS_TOTAL: "12" },
        { query: "", calls: 1 },
        { query: "select 2", calls: "abc", total_ms: "", mean_ms: "1e3" },
      ]),
    );
    expect(entries).toEqual([
      { sql: "select 1", calls: 12, totalMs: 30.5, meanMs: 2.5, maxMs: null, rows: 12 },
      { sql: "select 2", calls: null, totalMs: null, meanMs: 1000, maxMs: null, rows: null },
    ]);
  });

  test("übersetzt fehlende Voraussetzungen in Hinweise", () => {
    expect(queryStatsHint("postgres", 'relation "pg_stat_statements" does not exist')).toContain(
      "shared_preload_libraries",
    );
    expect(queryStatsHint("mssql", "VIEW SERVER STATE permission was denied")).toContain(
      "VIEW SERVER STATE",
    );
    expect(queryStatsHint("oracle", "ORA-00942: table or view does not exist")).toContain(
      "V$SQLAREA",
    );
    expect(queryStatsHint("postgres", "connection refused")).toBeNull();
  });

  test("loadQueryStats wirft für Familien ohne Statistik", async () => {
    await expect(loadQueryStats("sqlite", 10, async () => result([]))).rejects.toThrow(
      /keine Statement-Statistik/,
    );
  });

  test("loadQueryStats weicht bei MySQL ohne QUERY_SAMPLE_TEXT auf DIGEST_TEXT aus", async () => {
    const seen: string[] = [];
    const entries = await loadQueryStats("mysql", 5, async (sql) => {
      seen.push(sql);
      if (sql.includes("QUERY_SAMPLE_TEXT")) throw new Error("Unknown column 'QUERY_SAMPLE_TEXT'");
      return result([{ query: "SELECT 1", calls: 2, total_ms: 4, mean_ms: 2, max_ms: 3, rows_total: 2 }]);
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("DIGEST_TEXT");
    expect(entries[0]).toMatchObject({ sql: "SELECT 1", calls: 2, meanMs: 2 });
  });

  test("loadQueryStats ergänzt Fehler um einen Einrichtungshinweis", async () => {
    await expect(
      loadQueryStats("postgres", 5, async () => {
        throw new Error('relation "pg_stat_statements" does not exist');
      }),
    ).rejects.toThrow(/pg_stat_statements/);
  });
});

describe("Platzhalter", () => {
  test("erkennt Platzhalter je Dialekt und ignoriert Literale und Kommentare", () => {
    expect(detectPlaceholders("select * from t where a = $1 and b = $2 or c = $1", "postgres")).toEqual([
      "$1",
      "$2",
    ]);
    expect(detectPlaceholders("select '$9' as x -- $8\n from t where a = $1", "postgres")).toEqual([
      "$1",
    ]);
    expect(detectPlaceholders("select * from t where a = ? and b = ?", "mysql")).toEqual(["?1", "?2"]);
    expect(detectPlaceholders("select * from t where a = @p1", "mssql")).toEqual(["@p1"]);
    expect(detectPlaceholders("select * from t where a = :id and b = :name and c = :id", "oracle")).toEqual([
      ":id",
      ":name",
    ]);
    expect(detectPlaceholders("select a::text from t", "oracle")).toEqual([]);
    expect(detectPlaceholders("select 1", "sqlite")).toEqual([]);
  });

  test("nummeriert Oracle-Binds für den l8db-Adapter um", () => {
    expect(
      numberPlaceholders(
        "select * from t where a = :id and b = ':id' and c = :name -- :id\n and d = :id /* :x */ and e = \":id\"",
        "oracle",
      ),
    ).toBe(
      "select * from t where a = $1 and b = ':id' and c = $2 -- :id\n and d = $1 /* :x */ and e = \":id\"",
    );
    expect(numberPlaceholders("select * from t where a = :1 and b = :2", "oracle")).toBe(
      "select * from t where a = $1 and b = $2",
    );
    expect(numberPlaceholders("select 'it''s :x' from dual where a = :x", "oracle")).toBe(
      "select 'it''s :x' from dual where a = $1",
    );
    expect(numberPlaceholders("select * from t where a = $1", "postgres")).toBe(
      "select * from t where a = $1",
    );
  });
});

describe("Workload-Datei", () => {
  const statements: WorkloadStatement[] = [
    { sql: "select * from kunde where id = $1", calls: 10, meanMs: 1.5, params: ["7"] },
    { sql: "select count(*) from auftrag", calls: 3, meanMs: null, params: null },
  ];
  const saved = buildSavedWorkload(statements, context);

  test("Roundtrip", () => {
    const parsed = parseWorkloadFile(serializeWorkload(saved));
    expect(parsed.statements).toEqual(statements);
    expect(parsed.databaseKind).toBe("postgres");
  });

  test("übernimmt Top-Statements und kappt die Anzahl", () => {
    const many = Array.from({ length: WORKLOAD_MAX_STATEMENTS + 5 }, (_, index) => ({
      sql: `select ${index}`,
      calls: 1,
      totalMs: 1,
      meanMs: 1,
      maxMs: 1,
      rows: 1,
    }));
    const taken = statementsFromStats(many);
    expect(taken).toHaveLength(WORKLOAD_MAX_STATEMENTS);
    expect(taken[0]).toEqual({ sql: "select 0", calls: 1, meanMs: 1, params: null });
  });

  test("lehnt fremde, leere und zu große Dateien ab", () => {
    expect(() => parseWorkloadFile("{}")).toThrow(/Workload-Datei/);
    expect(() => parseWorkloadFile("nope")).toThrow(/JSON/);
    expect(() => parseWorkloadFile(serializeWorkload({ ...saved, statements: [] }))).toThrow(
      /keine Statements/,
    );
    expect(() => parseWorkloadFile(serializeWorkload({ ...saved, version: 99 }))).toThrow(
      /Dateiversion/,
    );
    const tooMany = Array.from({ length: WORKLOAD_MAX_STATEMENTS + 1 }, () => statements[1]);
    expect(() => parseWorkloadFile(serializeWorkload({ ...saved, statements: tooMany }))).toThrow(
      /mehr als/,
    );
    expect(() =>
      parseWorkloadFile(JSON.stringify({ ...saved, statements: [{ sql: " " }] })),
    ).toThrow(/SQL-Text/);
  });
});

describe("Replay", () => {
  test("skipReason prüft Schreibzugriffe und Parameter", () => {
    expect(skipReason({ sql: "delete from t", calls: null, meanMs: null, params: null }, "postgres", true)).toMatch(
      /lesende/,
    );
    const bound = { sql: "select * from t where id = $1", calls: null, meanMs: null, params: null };
    expect(skipReason(bound, "postgres", true)).toMatch(/\$1 fehlen/);
    expect(skipReason({ ...bound, params: ["1"] }, "postgres", true)).toBeNull();
    expect(skipReason({ ...bound, params: ["1"] }, "postgres", false)).toMatch(/nicht binden/);
    expect(skipReason({ sql: "select 1", calls: null, meanMs: null, params: null }, "mysql", false)).toBeNull();
  });

  test("spielt Statements ab, übergibt Parameter und überspringt Schreibzugriffe", async () => {
    const calls: { sql: string; params: string[] | null }[] = [];
    const results = await runWorkload({
      statements: [
        { sql: "select * from t where id = $1 and name = $2;", calls: null, meanMs: null, params: ["1", "x", "extra"] },
        { sql: "update t set a = 1", calls: null, meanMs: null, params: null },
        { sql: "-- top\nselect count(*) from t", calls: null, meanMs: null, params: null },
      ],
      repeats: 3,
      concurrency: 2,
      kind: "postgres",
      bindable: true,
      execute: async (sql, params) => {
        calls.push({ sql, params });
        return result([{ n: 1 }]);
      },
    });
    expect(results).toHaveLength(3);
    expect(results[0].runs).toHaveLength(3);
    expect(results[1].skipped).toMatch(/lesende/);
    expect(results[1].runs).toHaveLength(0);
    expect(results[2].runs).toHaveLength(3);
    expect(calls.filter((call) => call.sql.startsWith("update"))).toHaveLength(0);
    expect(calls[0]).toEqual({
      sql: "select * from t where id = $1 and name = $2",
      params: ["1", "x"],
    });
    expect(calls.at(-1)).toEqual({ sql: "select count(*) from t", params: null });
  });

  test("Oracle-Replay bindet :name-Platzhalter als $n", async () => {
    const calls: { sql: string; params: string[] | null }[] = [];
    await runWorkload({
      statements: [
        { sql: "SELECT * FROM kunde WHERE id = :id AND land = :land", calls: null, meanMs: null, params: ["7", "DE"] },
      ],
      repeats: 1,
      concurrency: 1,
      kind: "oracle",
      bindable: true,
      execute: async (sql, params) => {
        calls.push({ sql, params });
        return result([]);
      },
    });
    expect(calls).toEqual([
      { sql: "SELECT * FROM kunde WHERE id = $1 AND land = $2", params: ["7", "DE"] },
    ]);
  });

  test("Fehler landen im Lauf und stoppen das Statement beim ersten Versuch", async () => {
    const results = await runWorkload({
      statements: [
        { sql: "select * from missing", calls: null, meanMs: null, params: null },
        { sql: "select 1", calls: null, meanMs: null, params: null },
      ],
      repeats: 5,
      concurrency: 1,
      kind: "postgres",
      bindable: true,
      execute: async (sql) => {
        if (sql.includes("missing")) throw new Error('relation "missing" does not exist');
        return result([{ a: 1 }]);
      },
    });
    expect(results[0].runs).toHaveLength(1);
    expect(results[0].runs[0].error).toContain("missing");
    expect(results[1].runs).toHaveLength(5);
  });

  test("Abbruch beendet das Replay mit Teilergebnis", async () => {
    let cancelled = false;
    let count = 0;
    const results = await runWorkload({
      statements: [
        { sql: "select 1", calls: null, meanMs: null, params: null },
        { sql: "select 2", calls: null, meanMs: null, params: null },
      ],
      repeats: 10,
      concurrency: 1,
      kind: "mysql",
      bindable: false,
      isCancelled: () => cancelled,
      execute: async () => {
        count += 1;
        if (count === 3) cancelled = true;
        return result([]);
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0].runs).toHaveLength(3);
  });

  test("Ergebnisdatei Roundtrip und Vergleich je Statement", async () => {
    const run = (sql: string, ms: number[]) => ({
      sql,
      skipped: null,
      elapsedMs: 100,
      runs: ms.map((durationMs, index) => ({
        index: index + 1,
        startedAt: "",
        metrics: {
          durationMs,
          planTimeMs: null,
          rows: 1,
          planRows: null,
          totalCost: null,
          sharedHitBlocks: null,
          sharedReadBlocks: null,
          nodeCount: 0,
        },
        plan: null,
        error: null,
      })),
    });
    const left = buildSavedWorkloadResult(
      [run("SELECT 1", [10, 10, 10]), run("select   count(*) from t;", [4, 6]), run("select old", [1])],
      { repeats: 3, concurrency: 1 },
      { ...context, connectionName: "pg16" },
    );
    const right = buildSavedWorkloadResult(
      [run("select 1", [5, 5, 5]), run("-- neu\nSELECT COUNT(*) FROM T", [10, 10]), run("select new", [2])],
      { repeats: 3, concurrency: 1 },
      { ...context, connectionName: "pg18" },
    );
    const parsed = parseWorkloadResultFile(serializeWorkload(left));
    expect(parsed.results).toHaveLength(3);
    expect(parsed.connectionName).toBe("pg16");
    expect(() => parseWorkloadResultFile(serializeWorkload(buildSavedWorkload([{ sql: "select 1", calls: null, meanMs: null, params: null }], context)))).toThrow(
      /Workload-Ergebnis/,
    );

    const rows = compareWorkloadResults(parsed, right);
    expect(rows.map((row) => row.status)).toEqual(["both", "both", "only-left", "only-right"]);
    expect(rows[0].deltaMs).toBe(-5);
    expect(rows[0].ratio).toBe(-0.5);
    expect(rows[1].deltaMs).toBe(5);
    expect(rows[1].ratio).toBe(1);
    expect(rows[2].right).toBeNull();
    expect(rows[3].left).toBeNull();
    expect(rows[3].deltaMs).toBeNull();
  });
});
