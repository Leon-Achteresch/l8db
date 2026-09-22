import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const E2E = Boolean(process.env.L8DB_BENCHMARK_E2E);
const BIN = process.env.L8DB_BIN ?? join(import.meta.dir, "../src-tauri/target/debug/l8db");
const PG_URL =
  process.env.L8DB_BENCHMARK_PG_URL ??
  "postgresql://postgres:testpw@127.0.0.1:15432/postgres?sslmode=disable";
const TABLE = "l8db_bench_cli";

let dir = "";

function writeConfig(enabled: boolean) {
  const connection = (id: string, name: string, readOnly: boolean) => ({
    id: `${id}-${process.pid}`,
    name,
    kind: "postgres",
    connectionString: PG_URL,
    schemas: [],
    ssh: false,
    exposed: true,
    readOnly,
    allowDdl: !readOnly,
    redactColumns: [],
  });
  writeFileSync(
    join(dir, "mcp.json"),
    JSON.stringify({
      enabled,
      connections: [connection("bench-ro", "BenchRO", true), connection("bench-rw", "BenchRW", false)],
    }),
  );
}

function env() {
  return { ...process.env, L8DB_MCP_CONFIG: join(dir, "mcp.json") };
}

function rpc(lines: object[]): Record<string, unknown>[] {
  const run = spawnSync(BIN, ["--mcp"], {
    input: `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    env: env(),
    encoding: "utf8",
    timeout: 120_000,
  });
  if (run.status !== 0) throw new Error(`mcp exit ${run.status}: ${run.stderr}`);
  return run.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function call(id: number, name: string, args: object) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function text(reply: Record<string, unknown>): { error: boolean; text: string } {
  const result = reply.result as { isError: boolean; content: { text: string }[] };
  return { error: result.isError, text: result.content[0]?.text ?? "" };
}

function cli(args: string[]) {
  return spawnSync(BIN, ["--benchmark", ...args], { env: env(), encoding: "utf8", timeout: 180_000 });
}

function rowCount(): string {
  const [reply] = rpc([call(1, "query", { connection: "BenchRO", sql: `SELECT count(*) AS n FROM ${TABLE}` })]);
  return text(reply).text;
}

describe.skipIf(!E2E)("Benchmark über MCP und CLI mit dem echten Binary", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "l8db-bench-e2e-"));
    writeConfig(true);
    const replies = rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      call(2, "execute", { connection: "BenchRW", sql: `DROP TABLE IF EXISTS ${TABLE}`, confirm: true }),
      call(3, "execute", {
        connection: "BenchRW",
        sql: `CREATE TABLE ${TABLE}(id int primary key, status text)`,
        confirm: true,
      }),
      call(4, "execute", {
        connection: "BenchRW",
        sql: `INSERT INTO ${TABLE} SELECT g, CASE WHEN g % 2 = 0 THEN 'paid' ELSE 'open' END FROM generate_series(1, 1000) g`,
        confirm: true,
      }),
    ]);
    for (const reply of replies.slice(1)) expect(text(reply).error, text(reply).text).toBe(false);
  });

  afterAll(() => {
    writeConfig(true);
    rpc([call(9, "execute", { connection: "BenchRW", sql: `DROP TABLE IF EXISTS ${TABLE}`, confirm: true })]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("MCP listet und führt benchmark mit Parallelität aus", () => {
    const [list, bench] = rpc([
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      call(2, "benchmark", {
        connection: "BenchRO",
        sql: `SELECT status, count(*) FROM ${TABLE} GROUP BY status`,
        repeats: 24,
        concurrency: 4,
      }),
    ]);
    const tools = (list.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(tools).toContain("benchmark");
    const reply = text(bench);
    expect(reply.error, reply.text).toBe(false);
    const report = JSON.parse(reply.text);
    expect(report.concurrency).toBe(4);
    expect(report.statements[0].runs).toBe(24);
    expect(report.statements[0].errors).toBe(0);
    expect(report.statements[0].p95_ms).toBeGreaterThanOrEqual(report.statements[0].median_ms);
    expect(reply.text).not.toContain("paid");
  });

  test("CLI liefert JSON und Exit-Code 0", () => {
    const run = cli(["--connection", "BenchRO", "--sql", `SELECT * FROM ${TABLE} WHERE id < 100`, "--repeats", "30", "--concurrency", "3"]);
    expect(run.status, run.stderr).toBe(0);
    const report = JSON.parse(run.stdout);
    expect(report.repeats).toBe(30);
    expect(report.statements[0].runs).toBe(30);
    expect(report.statements[0].throughput_per_sec).toBeGreaterThan(0);
  });

  test("CLI schlägt bei überschrittener Median-Schwelle fehl", () => {
    const run = cli(["--connection", "BenchRO", "--sql", `SELECT count(*) FROM ${TABLE}`, "--repeats", "3", "--max-median-ms", "0.000001"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Median");
    expect(JSON.parse(run.stdout).statements[0].runs).toBe(3);
  });

  test("CLI verweigert Schreibzugriffe, Daten bleiben unverändert", () => {
    const before = rowCount();
    for (const sql of [`DELETE FROM ${TABLE}`, `SELECT 1; DELETE FROM ${TABLE}`, `WITH d AS (DELETE FROM ${TABLE} RETURNING *) SELECT * FROM d`]) {
      const run = cli(["--connection", "BenchRW", "--sql", sql, "--repeats", "2"]);
      expect(run.status, sql).toBe(1);
      expect(run.stdout).toBe("");
    }
    expect(rowCount()).toBe(before);
    expect(before).toContain("1000");
  });

  test("CLI spielt eine Workload-Datei mit gebundenen Parametern ab", () => {
    const file = join(dir, "bench.l8workload.json");
    writeFileSync(
      file,
      JSON.stringify({
        kind: "l8db.workload",
        version: 1,
        statements: [
          { sql: `SELECT count(*) FROM ${TABLE} WHERE status = $1`, params: ["paid"] },
          { sql: `UPDATE ${TABLE} SET status = 'x'` },
          { sql: `SELECT max(id) FROM ${TABLE}` },
        ],
      }),
    );
    const run = cli(["--connection", "BenchRO", "--file", file, "--repeats", "5"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("übersprungen");
    const report = JSON.parse(run.stdout);
    expect(report.statements).toHaveLength(2);
    expect(report.statements.every((entry: { runs: number; errors: number }) => entry.runs === 5 && entry.errors === 0)).toBe(true);
    expect(report.skipped).toHaveLength(1);
    expect(rowCount()).toContain("1000");
  });

  test("CLI prüft Argumente und MCP-Freigabe", () => {
    expect(cli(["--sql", "select 1"]).status).toBe(2);
    expect(cli(["--connection", "BenchRO"]).status).toBe(2);
    expect(cli(["--connection", "Unbekannt", "--sql", "select 1"]).status).toBe(1);
    writeConfig(false);
    const disabled = cli(["--connection", "BenchRO", "--sql", "select 1"]);
    writeConfig(true);
    expect(disabled.status).toBe(1);
    expect(disabled.stderr).toContain("deaktiviert");
  });

  test("Audit-Log protokolliert benchmark", () => {
    const audit = readFileSync(join(dir, "mcp-audit.jsonl"), "utf8");
    expect(audit).toContain('"benchmark"');
  });
});
