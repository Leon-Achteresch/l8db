import { describe, expect, test } from "bun:test";

import type { ExplainNode, QueryResult } from "../src/lib/db";
import {
  buildPerfTestSql,
  buildSavedPerfTest,
  isReadOnlyFor,
  normalizeConcurrency,
  PERF_FILE_VERSION,
  PERF_MAX_CONCURRENCY,
  type PerfRun,
  type PerfTestDefinition,
  parsePerfTestFile,
  percentile,
  perfRunAsSavedPlan,
  perfStatement,
  runMetricsFromResult,
  runPerfLoop,
  serializePerfTest,
  summarizeRuns,
} from "../src/lib/perf-test";

const plan = {
  "Node Type": "Seq Scan",
  "Startup Cost": 0,
  "Total Cost": 1,
  "Plan Rows": 1,
  "Plan Width": 1,
} as unknown as ExplainNode;

function timedRun(index: number, durationMs: number, error: string | null = null): PerfRun {
  return {
    index,
    startedAt: "2026-09-22T10:00:00.000Z",
    metrics: {
      durationMs,
      planTimeMs: null,
      rows: error ? null : 10,
      planRows: null,
      totalCost: null,
      sharedHitBlocks: null,
      sharedReadBlocks: null,
      nodeCount: 0,
    },
    plan: null,
    error,
  };
}

const definition: PerfTestDefinition = {
  schema: "ks",
  table: "events",
  filter: "day = '2026-09-22'",
  orderBy: null,
  limit: 50,
  repeats: 10,
  concurrency: 4,
  analyze: true,
  timed: true,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Parallelität und Perzentile", () => {
  test("p95 nutzt den nächsthöheren Rang", () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile([1, 2, 3], 0.95)).toBe(3);
    expect(percentile([7], 0.95)).toBe(7);
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(twenty, 0.95)).toBe(19);
  });

  test("normalizeConcurrency begrenzt auf 1 bis Maximum", () => {
    expect(normalizeConcurrency(0)).toBe(1);
    expect(normalizeConcurrency(3.6)).toBe(4);
    expect(normalizeConcurrency(999)).toBe(PERF_MAX_CONCURRENCY);
    expect(normalizeConcurrency(Number.NaN)).toBe(1);
  });

  test("summarizeRuns zählt Fehler getrennt und berechnet Durchsatz", () => {
    const summary = summarizeRuns(
      [timedRun(1, 10), timedRun(2, 30), timedRun(3, 5, "Timeout"), timedRun(4, 20)],
      2000,
    );
    expect(summary.errors).toBe(1);
    expect(summary.duration).toEqual({ count: 3, min: 10, median: 20, p95: 30, max: 30, avg: 20 });
    expect(summary.throughputPerSec).toBe(1.5);
    expect(summarizeRuns([timedRun(1, 1, "x")], 1000).throughputPerSec).toBeNull();
    expect(summarizeRuns([timedRun(1, 1)]).throughputPerSec).toBeNull();
  });

  test("runMetricsFromResult bevorzugt die Serverzeit und zählt Zeilen", () => {
    const result: QueryResult = {
      columns: ["a"],
      rows: [{ a: 1 }, { a: 2 }],
      rows_affected: null,
      execution_time_ms: 7,
    };
    const metrics = runMetricsFromResult(result, 12);
    expect(metrics.durationMs).toBe(7);
    expect(metrics.rows).toBe(2);
    expect(metrics.nodeCount).toBe(0);
    expect(
      runMetricsFromResult({ ...result, execution_time_ms: Number.NaN, rows: [], rows_affected: 5 }, 12),
    ).toMatchObject({ durationMs: 12, rows: 5 });
  });
});

describe("runPerfLoop", () => {
  test("hält die Parallelität ein und liefert Läufe sortiert", async () => {
    let active = 0;
    let peak = 0;
    const outcome = await runPerfLoop({
      repeats: 12,
      concurrency: 3,
      execute: async (index) => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(index % 2 === 0 ? 5 : 1);
        active -= 1;
        return timedRun(index, index);
      },
    });
    expect(peak).toBe(3);
    expect(outcome.runs.map((run) => run.index)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(outcome.aborted).toBeNull();
    expect(outcome.cancelled).toBe(false);
    expect(outcome.elapsedMs).toBeGreaterThan(0);
  });

  test("startet nie mehr Worker als Läufe", async () => {
    let calls = 0;
    const outcome = await runPerfLoop({
      repeats: 2,
      concurrency: 16,
      execute: async (index) => {
        calls += 1;
        return timedRun(index, 1);
      },
    });
    expect(calls).toBe(2);
    expect(outcome.runs).toHaveLength(2);
  });

  test("bricht ab, wenn schon der erste Lauf scheitert", async () => {
    let calls = 0;
    const outcome = await runPerfLoop({
      repeats: 50,
      concurrency: 1,
      execute: async (index) => {
        calls += 1;
        return timedRun(index, 1, "relation does not exist");
      },
    });
    expect(calls).toBe(1);
    expect(outcome.aborted).toBe("relation does not exist");
  });

  test("zählt spätere Fehler als Fehlläufe, ohne abzubrechen", async () => {
    const outcome = await runPerfLoop({
      repeats: 6,
      concurrency: 1,
      execute: async (index) => timedRun(index, 1, index === 3 ? "Deadlock" : null),
    });
    expect(outcome.aborted).toBeNull();
    expect(outcome.runs).toHaveLength(6);
    expect(summarizeRuns(outcome.runs).errors).toBe(1);
  });

  test("Abbruch stoppt neue Läufe, laufende werden noch gewertet", async () => {
    let cancelled = false;
    const progress: number[] = [];
    const outcome = await runPerfLoop({
      repeats: 100,
      concurrency: 2,
      isCancelled: () => cancelled,
      onProgress: (done) => progress.push(done),
      execute: async (index) => {
        await sleep(2);
        if (index === 4) cancelled = true;
        return timedRun(index, 1);
      },
    });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.runs.length).toBeGreaterThanOrEqual(4);
    expect(outcome.runs.length).toBeLessThan(10);
    expect(progress.at(-1)).toBe(outcome.runs.length);
  });
});

describe("Zeitmessung ohne EXPLAIN in der Datei", () => {
  const saved = buildSavedPerfTest(definition, [timedRun(1, 4), timedRun(2, 6, "boom")], "SELECT 1", {
    connectionName: "Cassandra",
    databaseKind: "cassandra",
    timed: true,
    concurrency: 4,
    elapsedMs: 12.5,
    capturedAt: new Date("2026-09-22T10:00:00.000Z"),
  });

  test("speichert Modus TIMED, Parallelität und Laufzeit", () => {
    expect(saved.version).toBe(PERF_FILE_VERSION);
    expect(saved.mode).toBe("TIMED");
    expect(saved.concurrency).toBe(4);
    expect(saved.elapsedMs).toBe(12.5);
  });

  test("Roundtrip erhält Fehler, planlose Läufe und Definition", () => {
    const parsed = parsePerfTestFile(serializePerfTest(saved));
    expect(parsed.mode).toBe("TIMED");
    expect(parsed.concurrency).toBe(4);
    expect(parsed.elapsedMs).toBe(12.5);
    expect(parsed.runs[0].plan).toBeNull();
    expect(parsed.runs[0].error).toBeNull();
    expect(parsed.runs[1].error).toBe("boom");
    expect(parsed.definition?.timed).toBe(true);
    expect(parsed.definition?.concurrency).toBe(4);
  });

  test("planlose Läufe liefern keinen Planvergleich", () => {
    expect(perfRunAsSavedPlan(saved, saved.runs[0])).toBeNull();
    const analyzed = buildSavedPerfTest(null, [{ ...timedRun(1, 1), plan }], "SELECT 1", {
      connectionName: "pg",
      databaseKind: "postgres",
    });
    expect(perfRunAsSavedPlan(analyzed, analyzed.runs[0])?.plan["Node Type"]).toBe("Seq Scan");
  });

  test("liest Dateien der Version 1 ohne Parallelität weiter", () => {
    const legacy = JSON.stringify({
      kind: "l8db.perf-test",
      version: 1,
      capturedAt: "2026-01-01T00:00:00.000Z",
      mode: "ANALYZE",
      sql: "select 1",
      connectionName: "alt",
      databaseKind: "postgres",
      database: "app",
      definition: {
        schema: "public",
        table: "kunde",
        filter: null,
        orderBy: null,
        limit: 10,
        repeats: 3,
        analyze: true,
      },
      runs: [{ index: 1, startedAt: "", metrics: { durationMs: 2 }, plan }],
    });
    const parsed = parsePerfTestFile(legacy);
    expect(parsed.concurrency).toBe(1);
    expect(parsed.elapsedMs).toBeNull();
    expect(parsed.definition?.timed).toBe(false);
    expect(parsed.runs[0].plan?.["Node Type"]).toBe("Seq Scan");
  });

  test("lehnt unbekannte Modi ab", () => {
    expect(() =>
      parsePerfTestFile(serializePerfTest({ ...saved, mode: "WILD" as never })),
    ).toThrow(/TIMED/);
  });
});

describe("Tabellen-Statement je Datenbankfamilie", () => {
  test("CQL mit Filter bekommt ALLOW FILTERING", () => {
    expect(buildPerfTestSql(definition, "cassandra")).toBe(
      `SELECT * FROM "ks"."events" WHERE day = '2026-09-22' LIMIT 50 ALLOW FILTERING`,
    );
    expect(buildPerfTestSql({ ...definition, filter: null }, "cassandra")).toBe(
      'SELECT * FROM "ks"."events" LIMIT 50',
    );
  });

  test("MongoDB bekommt einen find-Aufruf mit Filter, Sortierung und Limit", () => {
    expect(
      buildPerfTestSql(
        { ...definition, table: "orders", filter: '{"status": "paid"}', orderBy: '{"_id": -1}' },
        "mongodb",
      ),
    ).toBe('db.getCollection("orders").find({"status": "paid"}).sort({"_id": -1}).limit(50)');
    expect(buildPerfTestSql({ ...definition, table: "orders", filter: null, limit: null }, "mongodb")).toBe(
      'db.getCollection("orders").find({})',
    );
  });
});

describe("Lese-Prüfung je Abfragesprache", () => {
  test("SQL und CQL", () => {
    expect(isReadOnlyFor("sql", "select * from t")).toBe(true);
    expect(isReadOnlyFor("cql", "SELECT * FROM ks.t LIMIT 5 ALLOW FILTERING")).toBe(true);
    expect(isReadOnlyFor("sql", "select 1; delete from t")).toBe(false);
    expect(isReadOnlyFor("sql", "SELECT * FROM t WHERE a = 1; DROP TABLE t")).toBe(false);
    expect(isReadOnlyFor("sql", "update t set a = 1")).toBe(false);
  });

  test("MongoDB-Shell und Befehlsdokumente", () => {
    expect(isReadOnlyFor("json", 'db.orders.find({"a": 1}).limit(5)')).toBe(true);
    expect(isReadOnlyFor("json", 'db.getCollection("orders").find({}).sort({"_id": -1})')).toBe(true);
    expect(isReadOnlyFor("json", "db.orders.aggregate([{ $match: {} }])")).toBe(true);
    expect(isReadOnlyFor("json", "db.orders.countDocuments({})")).toBe(true);
    expect(isReadOnlyFor("json", '{"find": "orders", "filter": {}}')).toBe(true);
    expect(isReadOnlyFor("json", "db.orders.aggregate([{ $out: 'copy' }])")).toBe(false);
    expect(isReadOnlyFor("json", 'db.orders.aggregate([{"$merge": {"into": "x"}}])')).toBe(false);
    expect(isReadOnlyFor("json", "db.orders.deleteMany({})")).toBe(false);
    expect(isReadOnlyFor("json", "db.orders.insertOne({a: 1})")).toBe(false);
    expect(isReadOnlyFor("json", "db.orders.drop()")).toBe(false);
    expect(isReadOnlyFor("json", 'db.orders.find({}); db.orders.drop()')).toBe(false);
    expect(isReadOnlyFor("json", '{"delete": "orders", "deletes": []}')).toBe(false);
    expect(isReadOnlyFor("json", "kein json")).toBe(false);
    expect(isReadOnlyFor("json", "")).toBe(false);
  });

  test("Redis erlaubt nur lesende Befehle je Zeile", () => {
    expect(isReadOnlyFor("redis", "GET user:1")).toBe(true);
    expect(isReadOnlyFor("redis", "hgetall user:1\n# Kommentar\nSCAN 0 MATCH user:*")).toBe(true);
    expect(isReadOnlyFor("redis", "GET a\nDEL a")).toBe(false);
    expect(isReadOnlyFor("redis", "FLUSHALL")).toBe(false);
    expect(isReadOnlyFor("redis", "KEYS *")).toBe(false);
    expect(isReadOnlyFor("redis", "   ")).toBe(false);
  });

  test("perfStatement erhält Zeilen bei Redis und kürzt SQL", () => {
    expect(perfStatement("redis", "  GET a\nGET b  ")).toBe("GET a\nGET b");
    expect(perfStatement("json", "db.a.find({});  ")).toBe("db.a.find({})");
    expect(perfStatement("sql", "-- x\nselect 1 ;")).toBe("select 1");
  });
});
