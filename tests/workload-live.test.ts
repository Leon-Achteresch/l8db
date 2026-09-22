import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DatabaseKind, QueryResult } from "../src/lib/db";
import { buildPerfTestSql, isReadOnlyFor, type PerfTestDefinition } from "../src/lib/perf-test";
import { parseQueryStats, queryStatsHint, queryStatsSql } from "../src/lib/query-stats";
import { detectPlaceholders, numberPlaceholders, skipReason } from "../src/lib/workload";

const LIVE = Boolean(process.env.L8DB_WORKLOAD_LIVE);
const ROOT = join(import.meta.dir, "..");
const MARKER = "l8db_qs_orders";

interface Step {
  id?: string;
  sql: string;
  params?: string[];
  times?: number;
  must_succeed?: boolean;
  pause_ms?: number;
}

interface Case {
  name: string;
  kind: DatabaseKind;
  url: string;
  steps: Step[];
}

type StepResult = { ok: true; result: QueryResult } | { ok: false; error: string };

const url = (name: string, fallback: string) =>
  process.env[`L8DB_LIVE_${name.toUpperCase().replace(/-/g, "_")}_URL`] ?? fallback;

const enabled = (process.env.L8DB_WORKLOAD_LIVE_KINDS ?? "postgres,mysql,mssql,clickhouse,oracle,mongodb,redis,cassandra")
  .split(",")
  .map((kind) => kind.trim());

function definition(patch: Partial<PerfTestDefinition>): PerfTestDefinition {
  return {
    schema: "",
    table: MARKER,
    filter: null,
    orderBy: null,
    limit: 50,
    repeats: 1,
    concurrency: 1,
    analyze: true,
    timed: true,
    ...patch,
  };
}

function runPlan(cases: Case[]): Record<string, Record<string, StepResult>> {
  const dir = mkdtempSync(join(tmpdir(), "l8db-live-"));
  try {
    const plan = join(dir, "plan.json");
    const out = join(dir, "out.json");
    writeFileSync(plan, JSON.stringify({ cases }));
    const run = spawnSync(
      "cargo",
      ["test", "--lib", "live_plan", "--", "--ignored", "--nocapture", "--test-threads=1"],
      {
        cwd: join(ROOT, "src-tauri"),
        env: { ...process.env, L8DB_LIVE_PLAN: plan, L8DB_LIVE_OUT: out },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (run.status !== 0) throw new Error(`cargo live_plan failed:\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const paidFilter = "status = 'paid'";
const warm = `SELECT count(*) FROM ${MARKER} WHERE ${paidFilter}`;

function statsCases(): Case[] {
  const all: Case[] = [
    {
      name: "postgres",
      kind: "postgres",
      url: url("postgres", "postgresql://postgres:testpw@127.0.0.1:15432/postgres?sslmode=disable"),
      steps: [
        { sql: "CREATE EXTENSION IF NOT EXISTS pg_stat_statements", must_succeed: true },
        { sql: `DROP TABLE IF EXISTS ${MARKER}` },
        { sql: `CREATE TABLE ${MARKER}(id int primary key, status text, amount numeric)`, must_succeed: true },
        {
          sql: `INSERT INTO ${MARKER} SELECT g, CASE WHEN g % 2 = 0 THEN 'paid' ELSE 'open' END, g FROM generate_series(1, 500) g`,
          must_succeed: true,
        },
        { sql: "SELECT pg_stat_statements_reset()", must_succeed: true },
        { sql: warm, times: 7, must_succeed: true },
        { id: "stats", sql: queryStatsSql("postgres", 25) ?? "" },
        { id: "perf", sql: buildPerfTestSql(definition({ schema: "public", filter: paidFilter }), "postgres") },
        { sql: "DROP DATABASE IF EXISTS l8db_qs_noext" },
        { sql: "CREATE DATABASE l8db_qs_noext", must_succeed: true },
      ],
    },
    {
      name: "postgres-noext",
      kind: "postgres",
      url: url(
        "postgres-noext",
        "postgresql://postgres:testpw@127.0.0.1:15432/l8db_qs_noext?sslmode=disable",
      ),
      steps: [{ id: "stats", sql: queryStatsSql("postgres", 25) ?? "" }],
    },
    {
      name: "mysql",
      kind: "mysql",
      url: url("mysql", "mysql://root:testpw@127.0.0.1:13306/shop"),
      steps: [
        { sql: `DROP TABLE IF EXISTS ${MARKER}` },
        {
          sql: `CREATE TABLE ${MARKER}(id int primary key, status varchar(20), amount decimal(10,2))`,
          must_succeed: true,
        },
        {
          sql: `INSERT INTO ${MARKER} VALUES (1,'paid',10),(2,'open',20),(3,'paid',30),(4,'paid',40)`,
          must_succeed: true,
        },
        { sql: "TRUNCATE TABLE performance_schema.events_statements_summary_by_digest", must_succeed: true },
        { sql: warm, times: 7, must_succeed: true },
        { id: "stats", sql: queryStatsSql("mysql", 25) ?? "" },
        { id: "stats-fallback", sql: queryStatsSql("mysql", 25, true) ?? "" },
        { id: "perf", sql: buildPerfTestSql(definition({ schema: "shop", filter: paidFilter }), "mysql") },
      ],
    },
    {
      name: "mssql",
      kind: "mssql",
      url: url("mssql", "mssql://sa:L8db-Test-pw1@127.0.0.1:14339/master?encrypt=false"),
      steps: [
        { sql: `IF OBJECT_ID('dbo.${MARKER}') IS NOT NULL DROP TABLE dbo.${MARKER}` },
        {
          sql: `CREATE TABLE dbo.${MARKER}(id int primary key, status nvarchar(20), amount decimal(10,2))`,
          must_succeed: true,
        },
        {
          sql: `INSERT INTO dbo.${MARKER} VALUES (1,'paid',10),(2,'open',20),(3,'paid',30)`,
          must_succeed: true,
        },
        { sql: "DBCC FREEPROCCACHE" },
        { sql: warm, times: 7, must_succeed: true },
        { id: "stats", sql: queryStatsSql("mssql", 25) ?? "" },
        { id: "perf", sql: buildPerfTestSql(definition({ schema: "dbo", filter: paidFilter }), "mssql") },
      ],
    },
    {
      name: "clickhouse",
      kind: "clickhouse",
      url: url("clickhouse", "clickhouse://l8db:l8db@127.0.0.1:18123/shop"),
      steps: [
        { sql: `DROP TABLE IF EXISTS shop.${MARKER}` },
        {
          sql: `CREATE TABLE shop.${MARKER} (id UInt32, status String, amount Float64) ENGINE = MergeTree ORDER BY id`,
          must_succeed: true,
        },
        {
          sql: `INSERT INTO shop.${MARKER} SELECT number, if(number % 2 = 0, 'paid', 'open'), number FROM numbers(500)`,
          must_succeed: true,
        },
        { sql: warm, times: 7, must_succeed: true },
        { sql: "SYSTEM FLUSH LOGS", must_succeed: true },
        { id: "stats", sql: queryStatsSql("clickhouse", 25) ?? "" },
        { id: "perf", sql: buildPerfTestSql(definition({ schema: "shop", filter: paidFilter }), "clickhouse") },
      ],
    },
    {
      name: "oracle-app",
      kind: "oracle",
      url: url("oracle-app", "oracle://l8db:l8dbtest@localhost:15219/FREEPDB1"),
      steps: [
        { sql: `BEGIN EXECUTE IMMEDIATE 'DROP TABLE ${MARKER}'; EXCEPTION WHEN OTHERS THEN NULL; END;` },
        {
          sql: `CREATE TABLE ${MARKER}(id NUMBER PRIMARY KEY, status VARCHAR2(20), amount NUMBER)`,
          must_succeed: true,
        },
        {
          sql: `INSERT INTO ${MARKER} SELECT level, CASE WHEN MOD(level, 2) = 0 THEN 'paid' ELSE 'open' END, level FROM dual CONNECT BY level <= 500`,
          must_succeed: true,
        },
        { sql: "COMMIT" },
        { sql: warm, times: 7, must_succeed: true },
        { id: "stats", sql: queryStatsSql("oracle", 25) ?? "" },
        {
          id: "perf",
          sql: buildPerfTestSql(
            definition({ schema: "L8DB", table: MARKER.toUpperCase(), filter: paidFilter }),
            "oracle",
          ),
        },
        {
          id: "bound",
          sql: numberPlaceholders(`SELECT count(*) AS n FROM ${MARKER} WHERE status = :status`, "oracle"),
          params: ["paid"],
        },
      ],
    },
    {
      name: "oracle-system",
      kind: "oracle",
      url: url("oracle-system", "oracle://system:l8dbtest@localhost:15219/FREEPDB1"),
      steps: [{ id: "stats", sql: queryStatsSql("oracle", 100) ?? "" }],
    },
    {
      name: "mongodb",
      kind: "mongodb",
      url: url("mongodb", "mongodb://127.0.0.1:17017/shop"),
      steps: [
        { sql: `{"drop": "${MARKER}"}` },
        {
          sql: JSON.stringify({
            insert: MARKER,
            documents: Array.from({ length: 40 }, (_, index) => ({
              _id: index + 1,
              status: index % 2 === 0 ? "paid" : "open",
            })),
          }),
          must_succeed: true,
        },
        {
          id: "perf",
          sql: buildPerfTestSql(
            definition({ filter: '{"status": "paid"}', orderBy: '{"_id": -1}', limit: 10 }),
            "mongodb",
          ),
        },
      ],
    },
    {
      name: "redis",
      kind: "redis",
      url: url("redis", "redis://127.0.0.1:16379"),
      steps: [
        { sql: "SET l8db:qs:a 1", must_succeed: true },
        { sql: "HSET l8db:qs:h field value", must_succeed: true },
        { id: "perf", sql: "GET l8db:qs:a\nHGETALL l8db:qs:h" },
      ],
    },
    {
      name: "cassandra",
      kind: "cassandra",
      url: url("cassandra", "cassandra://127.0.0.1:19042"),
      steps: [
        {
          sql: "CREATE KEYSPACE IF NOT EXISTS l8db_qs WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}",
          must_succeed: true,
        },
        {
          sql: "CREATE TABLE IF NOT EXISTS l8db_qs.orders (id int PRIMARY KEY, status text, amount double)",
          must_succeed: true,
        },
        { sql: "INSERT INTO l8db_qs.orders (id, status, amount) VALUES (1, 'paid', 10)", must_succeed: true },
        { sql: "INSERT INTO l8db_qs.orders (id, status, amount) VALUES (2, 'open', 20)", must_succeed: true },
        { sql: "INSERT INTO l8db_qs.orders (id, status, amount) VALUES (3, 'paid', 30)", must_succeed: true },
        {
          id: "perf",
          sql: buildPerfTestSql(
            definition({ schema: "l8db_qs", table: "orders", filter: paidFilter }),
            "cassandra",
          ),
        },
        { id: "no-allow-filtering", sql: `SELECT * FROM "l8db_qs"."orders" WHERE ${paidFilter} LIMIT 50` },
      ],
    },
  ];
  return all.filter((entry) => enabled.includes(entry.name.split("-")[0]));
}

function ok(results: Record<string, Record<string, StepResult>>, name: string, id: string): QueryResult {
  const entry = results[name]?.[id];
  if (!entry) throw new Error(`${name}/${id} fehlt im Ergebnis`);
  if (!entry.ok) throw new Error(`${name}/${id}: ${entry.error}`);
  return entry.result;
}

function failed(results: Record<string, Record<string, StepResult>>, name: string, id: string): string {
  const entry = results[name]?.[id];
  if (!entry) throw new Error(`${name}/${id} fehlt im Ergebnis`);
  if (entry.ok) throw new Error(`${name}/${id} sollte fehlschlagen`);
  return entry.error;
}

const has = (name: string) => statsCases().some((entry) => entry.name === name);

describe.skipIf(!LIVE)("Workload und Perf-Test gegen echte Datenbanken", () => {
  let results: Record<string, Record<string, StepResult>> = {};

  test(
    "Phase 1: Statistik, Tabellen-Statements und Lese-Prüfung",
    () => {
      const cases = statsCases();
      for (const entry of cases) {
        for (const step of entry.steps.filter((candidate) => candidate.id === "perf")) {
          const language =
            entry.kind === "mongodb" ? "json" : entry.kind === "redis" ? "redis" : entry.kind === "cassandra" ? "cql" : "sql";
          expect(isReadOnlyFor(language, step.sql)).toBe(true);
        }
      }
      results = runPlan(cases);

      for (const name of ["postgres", "mysql", "mssql", "clickhouse", "oracle-system"]) {
        if (!has(name)) continue;
        const entries = parseQueryStats(ok(results, name, "stats"));
        const marker = entries
          .filter((entry) => entry.sql.toLowerCase().includes(MARKER) && /count\(/i.test(entry.sql))
          .sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0))[0];
        expect(marker, `${name}: ${JSON.stringify(entries.slice(0, 5))}`).toBeDefined();
        expect(marker?.calls ?? 0).toBeGreaterThanOrEqual(7);
        expect(marker?.totalMs ?? -1).toBeGreaterThanOrEqual(0);
        expect(marker?.meanMs ?? -1).toBeGreaterThanOrEqual(0);
        expect(entries.every((entry) => !/pg_stat_statements|events_statements_summary|dm_exec_query_stats|system\.query_log|v\$sqlarea/i.test(entry.sql))).toBe(true);
      }

      if (has("mysql")) {
        expect(parseQueryStats(ok(results, "mysql", "stats-fallback")).length).toBeGreaterThan(0);
      }

      if (has("postgres-noext")) {
        const error = failed(results, "postgres-noext", "stats");
        expect(queryStatsHint("postgres", error)).toContain("shared_preload_libraries");
      }
      if (has("oracle-app")) {
        const error = failed(results, "oracle-app", "stats");
        expect(queryStatsHint("oracle", error)).toContain("V$SQLAREA");
        expect(ok(results, "oracle-app", "bound").rows).toHaveLength(1);
      }

      const expectRows = (name: string, count: number) => {
        if (!has(name)) return;
        expect(ok(results, name, "perf").rows.length, name).toBe(count);
      };
      expectRows("postgres", 50);
      expectRows("mysql", 3);
      expectRows("mssql", 2);
      expectRows("clickhouse", 50);
      expectRows("oracle-app", 50);
      expectRows("cassandra", 2);
      if (has("mongodb")) {
        const rows = ok(results, "mongodb", "perf").rows;
        expect(rows).toHaveLength(10);
        expect(JSON.stringify(rows)).not.toContain('"open"');
      }
      if (has("redis")) expect(ok(results, "redis", "perf").rows.length).toBeGreaterThan(0);
      if (has("cassandra")) expect(failed(results, "cassandra", "no-allow-filtering")).toMatch(/ALLOW FILTERING/i);
    },
    900_000,
  );

  test.skipIf(!enabled.includes("postgres"))(
    "Phase 2: normalisiertes Statement aus pg_stat_statements mit Parametern abspielen",
    () => {
      const entries = parseQueryStats(ok(results, "postgres", "stats"));
      const marker = entries.find(
        (entry) => entry.sql.includes(MARKER) && /count\(/i.test(entry.sql) && entry.sql.includes("$1"),
      );
      expect(marker, JSON.stringify(entries.slice(0, 5))).toBeDefined();
      const sql = marker?.sql ?? "";
      expect(detectPlaceholders(sql, "postgres")).toEqual(["$1"]);
      const statement = { sql, calls: marker?.calls ?? null, meanMs: null, params: null };
      expect(skipReason(statement, "postgres", true)).toMatch(/\$1 fehlen/);
      expect(skipReason({ ...statement, params: ["paid"] }, "postgres", true)).toBeNull();
      const replay = runPlan([
        {
          name: "postgres",
          kind: "postgres",
          url: url("postgres", "postgresql://postgres:testpw@127.0.0.1:15432/postgres?sslmode=disable"),
          steps: [
            { id: "replay", sql, params: ["paid"], times: 5 },
            { id: "cleanup", sql: `DROP TABLE ${MARKER}` },
          ],
        },
      ]);
      const rows = ok(replay, "postgres", "replay").rows;
      expect(rows).toHaveLength(1);
      expect(Number(Object.values(rows[0] ?? {})[0])).toBe(250);
    },
    600_000,
  );
});
