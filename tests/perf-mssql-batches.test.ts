import { expect, test } from "bun:test";
import { splitSqlStatements } from "@/lib/sql-statements";

function script(batches: number) {
  const parts: string[] = [];
  for (let n = 0; n < batches; n += 1) {
    parts.push(
      n % 2
        ? `DECLARE @x${n} INT = ${n}; SELECT @x${n} AS v; UPDATE t SET a = @x${n} WHERE id = ${n};`
        : `SELECT ${n} AS a; INSERT INTO t VALUES (${n}, 'x;y'); SELECT @@ROWCOUNT;`,
    );
  }
  return parts.join("\nGO\n");
}

test("SQL Server batch grouping stays linear on large scripts", () => {
  const sql = script(4000);
  const runs: number[] = [];
  let statements = 0;
  for (let run = 0; run < 15; run += 1) {
    const started = performance.now();
    statements = splitSqlStatements(sql, "mssql").statements.length;
    runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  const p95 = runs[Math.floor(runs.length * 0.95)];
  console.log(
    `mssql batches: ${sql.length} chars, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
  );
  expect(statements).toBe(2000 * 3 + 2000);
  expect(median).toBeLessThan(250);
  expect(p95).toBeLessThan(500);
});
