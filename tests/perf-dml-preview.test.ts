import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import type { QueryResult } from "../src/lib/db/types";
import { deriveDmlPreview, needsDmlPreview, runDmlPreview } from "../src/lib/dml-preview";

const DIALECTS = ["postgres", "mysql", "mssql", "sqlite", "oracle"] as const;

function statement(index: number): string {
  switch (index % 4) {
    case 0:
      return `UPDATE accounts SET balance = balance - ${index}, note = 'WHERE ${index}' WHERE id = ${index} AND region IN (SELECT region FROM regions WHERE active = 1)`;
    case 1:
      return `DELETE FROM sessions /* expired */ WHERE last_seen < '2026-01-01' AND user_id = ${index}`;
    case 2:
      return `INSERT INTO archive (id, payload) SELECT id, payload FROM events WHERE id > ${index}`;
    default:
      return `SELECT * FROM accounts WHERE id = ${index}`;
  }
}

test("DML preview derivation stays fast on large scripts in every dialect", async () => {
  const statements = Array.from({ length: 3000 }, (_, index) => statement(index));
  const script = statements.map((text) => `${text};`).join("\n");
  const batch = statements.slice(0, 500);
  const inList = Array.from({ length: 20000 }, (_, index) => index).join(", ");
  const wide = `UPDATE orders SET status = 'archived', updated = now() WHERE id IN (${inList}) AND note <> 'WHERE x'`;
  const results: Record<string, unknown> = {};
  for (const dialect of DIALECTS) {
    let detected = false;
    const scriptScan = await measureScenario(() => {
      detected = needsDmlPreview(script, dialect);
      const derived = deriveDmlPreview(script, dialect);
      if (derived?.status !== "unavailable") throw new Error("script must fall back");
    }, 5);
    let derivedStatements = 0;
    const perStatement = await measureScenario(() => {
      derivedStatements = 0;
      for (const text of batch) if (deriveDmlPreview(text, dialect)) derivedStatements++;
    }, 5);
    let wideStatus = "";
    const wideStatement = await measureScenario(() => {
      wideStatus = deriveDmlPreview(wide, dialect)?.status ?? "none";
    }, 5);
    expect(detected).toBe(true);
    expect(derivedStatements).toBe(375);
    expect(wideStatus).toBe("ready");
    expect(scriptScan.p95Ms).toBeLessThan(300);
    expect(perStatement.p95Ms).toBeLessThan(200);
    expect(wideStatement.p95Ms).toBeLessThan(250);
    results[dialect] = { scriptScan, perStatement, wideStatement };
  }
  await reportScenario("dml-preview-derivation", {
    scriptStatements: statements.length,
    scriptCharacters: script.length,
    wideStatementCharacters: wide.length,
    budgets: { scriptScanP95Ms: 300, batch500P95Ms: 200, wideStatementP95Ms: 250 },
    batchStatements: batch.length,
    dialects: results,
  });
}, 60_000);

test("each preview sends exactly one count and one sample request", async () => {
  const plan = deriveDmlPreview(
    "DELETE FROM sessions WHERE last_seen < '2026-01-01'",
    "postgres",
    100,
  );
  if (plan?.status !== "ready") throw new Error("not derivable");
  const sampleRows = Array.from({ length: 1000 }, (_, id) => ({ id, payload: "x".repeat(64) }));
  const requests: string[] = [];
  const executor = {
    execute: async (sql: string): Promise<QueryResult> => {
      requests.push(sql);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return sql === plan.countSql
        ? {
            columns: ["affected_rows"],
            rows: [{ affected_rows: "250000" }],
            rows_affected: null,
            execution_time_ms: 1,
          }
        : {
            columns: ["id", "payload"],
            rows: sampleRows,
            rows_affected: null,
            execution_time_ms: 1,
          };
    },
    cancel: async () => false,
  };
  let retainedRows = 0;
  const timing = await measureScenario(async () => {
    requests.length = 0;
    const outcome = await runDmlPreview(plan, executor);
    retainedRows = outcome.sample.rows.length;
    if (requests.length !== 2) throw new Error(`expected 2 requests, saw ${requests.length}`);
  });
  expect(requests).toEqual([plan.countSql, plan.sampleSql]);
  expect(retainedRows).toBe(100);
  expect(timing.p95Ms).toBeLessThan(50);
  await reportScenario("dml-preview-requests", {
    ...timing,
    requestsPerPreview: 2,
    distinctRequests: new Set(requests).size,
    serverRowsReturned: sampleRows.length,
    retainedSampleRows: retainedRows,
    simulatedLatencyMsPerRequest: 1,
    pollingTimers: 0,
    p95BudgetMs: 50,
  });
});
