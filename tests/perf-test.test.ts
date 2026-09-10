import { describe, expect, test } from "bun:test";

import type { ExplainNode } from "../src/lib/db";
import {
  buildPerfTestSql,
  buildSavedPerfTest,
  defaultPerfFileName,
  normalizeRepeats,
  parsePerfTestFile,
  PERF_FILE_KIND,
  PERF_FILE_VERSION,
  PERF_MAX_REPEATS,
  perfRunAsSavedPlan,
  type PerfRun,
  type PerfTestDefinition,
  runMetricsFromPlan,
  serializePerfTest,
  summarize,
  summarizeRuns,
} from "../src/lib/perf-test";

const plan = {
  "Node Type": "Seq Scan",
  "Relation Name": "kunde",
  "Startup Cost": 0,
  "Total Cost": 42.5,
  "Plan Rows": 500,
  "Plan Width": 32,
  "Actual Total Time": 12.75,
  "Actual Rows": 480,
  "Shared Hit Blocks": 10,
  "Shared Read Blocks": 4,
  Plans: [
    {
      "Node Type": "Index Scan",
      "Index Name": "kunde_pkey",
      "Startup Cost": 0,
      "Total Cost": 8,
      "Plan Rows": 10,
      "Plan Width": 32,
      "Shared Hit Blocks": 5,
    },
  ],
} as unknown as ExplainNode;

const definition: PerfTestDefinition = {
  schema: "public",
  table: "kunde",
  filter: "aktiv = true",
  orderBy: "id DESC",
  limit: 1000,
  repeats: 3,
  analyze: true,
};

function run(index: number, durationMs: number, rows: number): PerfRun {
  return {
    index,
    startedAt: `2026-01-0${index}T10:00:00.000Z`,
    metrics: {
      durationMs,
      planTimeMs: 1,
      rows,
      planRows: 500,
      totalCost: 42.5,
      sharedHitBlocks: 15,
      sharedReadBlocks: 4,
      nodeCount: 2,
    },
    plan,
  };
}

describe("buildPerfTestSql", () => {
  test("baut SELECT mit Filter, Sortierung und LIMIT", () => {
    expect(buildPerfTestSql(definition, "postgres")).toBe(
      'SELECT * FROM "public"."kunde" WHERE aktiv = true ORDER BY id DESC LIMIT 1000',
    );
  });

  test("nutzt TOP für mssql", () => {
    expect(buildPerfTestSql({ ...definition, filter: null, orderBy: null }, "mssql")).toBe(
      "SELECT TOP 1000 * FROM [public].[kunde]",
    );
  });

  test("nutzt FETCH FIRST für oracle", () => {
    expect(buildPerfTestSql({ ...definition, filter: null, orderBy: null }, "oracle")).toBe(
      'SELECT * FROM "public"."kunde" FETCH FIRST 1000 ROWS ONLY',
    );
  });

  test("lässt LIMIT und Klauseln weg, wenn nichts gesetzt ist", () => {
    expect(
      buildPerfTestSql(
        { ...definition, filter: "  ", orderBy: "", limit: null },
        "mysql",
      ),
    ).toBe("SELECT * FROM `public`.`kunde`");
  });
});

describe("normalizeRepeats", () => {
  test("begrenzt auf gültigen Bereich", () => {
    expect(normalizeRepeats(0)).toBe(1);
    expect(normalizeRepeats(2.4)).toBe(2);
    expect(normalizeRepeats(99)).toBe(PERF_MAX_REPEATS);
    expect(normalizeRepeats(Number.NaN)).toBe(3);
  });
});

describe("runMetricsFromPlan", () => {
  test("summiert Buffer über den Planbaum und nutzt Execution Time", () => {
    const metrics = runMetricsFromPlan(plan, 30, { "Execution Time": 14.5, "Planning Time": 0.4 });
    expect(metrics.durationMs).toBe(14.5);
    expect(metrics.planTimeMs).toBe(0.4);
    expect(metrics.sharedHitBlocks).toBe(15);
    expect(metrics.sharedReadBlocks).toBe(4);
    expect(metrics.rows).toBe(480);
    expect(metrics.nodeCount).toBe(2);
  });

  test("fällt ohne Messwerte auf die Wanduhr zurück", () => {
    const bare = {
      "Node Type": "Seq Scan",
      "Startup Cost": 0,
      "Total Cost": 1,
      "Plan Rows": 1,
      "Plan Width": 1,
    } as unknown as ExplainNode;
    const metrics = runMetricsFromPlan(bare, 25);
    expect(metrics.durationMs).toBe(25);
    expect(metrics.rows).toBeNull();
    expect(metrics.sharedHitBlocks).toBeNull();
  });
});

describe("summarize", () => {
  test("berechnet min, median, max und avg bei ungerader Anzahl", () => {
    expect(summarize([30, 10, 20])).toEqual({
      count: 3,
      min: 10,
      median: 20,
      max: 30,
      avg: 20,
    });
  });

  test("median bei gerader Anzahl mittelt", () => {
    expect(summarize([10, 20, 30, 40])?.median).toBe(25);
  });

  test("ignoriert unbrauchbare Werte und liefert null bei leerer Liste", () => {
    expect(summarize([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    expect(summarize([])).toBeNull();
  });

  test("fasst Läufe zusammen", () => {
    const summary = summarizeRuns([run(1, 12, 100), run(2, 8, 100), run(3, 16, 100)]);
    expect(summary.duration).toEqual({ count: 3, min: 8, median: 12, max: 16, avg: 12 });
    expect(summary.rows?.median).toBe(100);
    expect(summary.planTime?.avg).toBe(1);
  });
});

describe("Perf-Datei", () => {
  const saved = buildSavedPerfTest(
    definition,
    [run(1, 12, 100), run(2, 8, 100)],
    'SELECT * FROM "public"."kunde"',
    {
      connectionName: "Lokal",
      databaseKind: "postgres",
      database: "app",
      capturedAt: new Date("2026-02-03T08:09:10.000Z"),
    },
  );

  test("enthält Version, Modus und Runs-Array", () => {
    expect(saved.kind).toBe(PERF_FILE_KIND);
    expect(saved.version).toBe(PERF_FILE_VERSION);
    expect(saved.mode).toBe("ANALYZE");
    expect(saved.runs).toHaveLength(2);
    expect(saved.definition.filter).toBe("aktiv = true");
  });

  test("Roundtrip über Serialisieren und Parsen", () => {
    const parsed = parsePerfTestFile(serializePerfTest(saved));
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[1].metrics.durationMs).toBe(8);
    expect(parsed.definition.orderBy).toBe("id DESC");
    expect(parsed.sql).toBe(saved.sql);
  });

  test("lehnt fremde Dateien ab", () => {
    expect(() => parsePerfTestFile("{}")).toThrow(/Performance-Datei/);
    expect(() => parsePerfTestFile("kein json")).toThrow(/JSON/);
  });

  test("lehnt neuere Dateiversionen ab", () => {
    const future = serializePerfTest({ ...saved, version: PERF_FILE_VERSION + 1 });
    expect(() => parsePerfTestFile(future)).toThrow(/Dateiversion/);
  });

  test("lehnt Dateien ohne Läufe ab", () => {
    const empty = serializePerfTest({ ...saved, runs: [] });
    expect(() => parsePerfTestFile(empty)).toThrow(/Läufe/);
  });

  test("Lauf lässt sich als Planobjekt für den Vergleich lesen", () => {
    const asPlan = perfRunAsSavedPlan(saved, saved.runs[0]);
    expect(asPlan.mode).toBe("ANALYZE");
    expect(asPlan.sql).toBe(saved.sql);
    expect(asPlan.plan["Node Type"]).toBe("Seq Scan");
  });

  test("Dateiname enthält Objekt und Zeitstempel", () => {
    const name = defaultPerfFileName({
      table: "Kunde Daten",
      capturedAt: new Date(2026, 1, 3, 8, 9, 10),
    });
    expect(name).toBe("kunde-daten-perf-20260203-080910.l8perf.json");
  });
});
