import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const E2E = process.env.L8DB_CHECK_E2E === "1";
const BIN = process.env.L8DB_BIN ?? join(import.meta.dir, "../src-tauri/target/debug/l8db");
let dir = "";

function run(checks: object[]) {
  const config = join(dir, "checks.json");
  const output = join(dir, "report.json");
  writeFileSync(config, JSON.stringify({ format: 1, checks }));
  const result = spawnSync(
    BIN,
    ["--check", "--config", config, "--url-env", "L8DB_CHECK_DATABASE_URL", "--output", output],
    {
      env: process.env,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  return { ...result, output };
}

describe.skipIf(!E2E)("Headless Prüf-CLI mit echtem Binary und PostgreSQL", () => {
  beforeAll(() => {
    if (!process.env.L8DB_CHECK_DATABASE_URL) throw new Error("L8DB_CHECK_DATABASE_URL fehlt.");
    dir = mkdtempSync(join(tmpdir(), "l8db-check-e2e-"));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("bestehende skalare und Planprüfungen liefern JSON und Exitcode 0", () => {
    const result = run([
      { type: "scalar_equals", id: "one", sql: "SELECT 1 AS value", expected: 1 },
      {
        type: "scalar_equals",
        id: "first-row-only",
        sql: "SELECT generate_series(1, 100000) AS value;",
        expected: 1,
      },
      {
        type: "plan",
        id: "plan",
        sql: "SELECT 1 AS value",
        max_cost: 100,
        max_seq_scans: 0,
        max_index_suggestions: 0,
      },
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.passed).toBe(true);
    expect(report.checks.map((check: { status: string }) => check.status)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
    expect(JSON.parse(readFileSync(result.output, "utf8"))).toEqual(report);
  }, 60_000);

  test("fehlgeschlagene Prüfung liefert Exitcode 1 und kein Datenbankergebnis", () => {
    const result = run([
      { type: "scalar_equals", id: "wrong", sql: "SELECT 987654321 AS value", expected: 1 },
    ]);
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.passed).toBe(false);
    expect(report.checks[0].status).toBe("failed");
    expect(result.stdout).not.toContain("987654321");
  }, 60_000);

  test("Schreibversuch wird vor Verbindung verworfen und alter Bericht entfernt", () => {
    const result = run([
      {
        type: "scalar_equals",
        id: "write",
        sql: "WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x",
        expected: 1,
      },
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nicht erlaubte Operation");
    expect(() => readFileSync(result.output)).toThrow();
  }, 60_000);

  test("Prüfdatei bleibt erhalten, wenn sie versehentlich als Ausgabe angegeben wird", () => {
    const config = join(dir, "same-file.json");
    const contents = JSON.stringify({
      format: 1,
      checks: [{ type: "scalar_equals", id: "one", sql: "SELECT 1", expected: 1 }],
    });
    writeFileSync(config, contents);
    const result = spawnSync(
      BIN,
      ["--check", "--config", config, "--url-env", "L8DB_CHECK_DATABASE_URL", "--output", config],
      { env: process.env, encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status).toBe(2);
    expect(readFileSync(config, "utf8")).toBe(contents);
  }, 60_000);
});
