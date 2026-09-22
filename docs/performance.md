# Performance tests, workloads and headless benchmarks

## Performance test (query editor and table tab)

The query editor (Analyse → Performance) and the table/view tab *Performance* repeat one read-only statement and report min, median, p95, max, average, throughput and errors.

- **Modes:** `EXPLAIN ANALYZE` collects plan metrics (planning time, buffers, cost, nodes) and is available where the family supports EXPLAIN. *Nur Laufzeit messen* runs the statement itself and records the driver-reported execution time (wall clock as fallback). Families without EXPLAIN always use this timed mode.
- **Load:** *Läufe gesamt* (1–500) is the total run count, and *Parallele Verbindungen* (1–16) caps the concurrent workers. Throughput is the number of successful runs divided by wall-clock time. p95 uses the nearest-rank method.
- **Errors:** if the first run fails, the test stops. Later failures are counted and excluded from the timing statistics.
- **Read-only only:** SQL/CQL must be a single `SELECT`/`WITH` statement. MongoDB must be `find`/`aggregate`/`count…` without `$out`/`$merge` or a read command document. Redis must be an allowlisted read command. The table tab is hidden for Redis.
- **Files:** runs are saved as `.l8perf.json` (version 2; version 1 files still load). Loading a file compares median, p95, max, throughput and errors with the current run. The plan comparison applies to EXPLAIN runs only.

## Workload tab (Monitor)

*Top-Statements des Servers* reads the server's statement statistics, sorted by total time:

| Family | Source | Requirement |
| --- | --- | --- |
| PostgreSQL | `pg_stat_statements` | extension installed and preloaded |
| MySQL/MariaDB | `performance_schema.events_statements_summary_by_digest` | performance_schema enabled |
| SQL Server | `sys.dm_exec_query_stats` | `VIEW SERVER STATE` |
| ClickHouse | `system.query_log` | query log enabled |
| Oracle | `V$SQLAREA` without Oracle-maintained schemas | `SELECT` on `V$SQLAREA` |

The statistics cover every client, not only l8db. Selected statements become a workload (at most 200 statements), which you can save as `.l8workload.json`. *Workload abspielen* replays it against any saved connection, with a chosen number of runs per statement and a parallelism level:

- Only read-only statements run. Anything else is listed as skipped.
- Placeholders (`$1`, `?`, `@p1`, `:name`) need values in the parameter fields. Oracle binds are renumbered for the driver. Families that cannot bind parameters skip parameterised statements.
- Results can be saved as `.l8wlresult.json`, kept as a baseline, or loaded as a baseline. The comparison matches statements by normalised SQL and shows the median delta and ratio.

## Headless: MCP tool and CLI

The MCP server exposes a `benchmark` tool on the same connections and read-only rules as `query`. It takes `connection`, then exactly one of `sql` or `file` (an absolute path to a `.l8perf.json` or `.l8workload.json`, at most 5 MB), plus optional `repeats` (1–500, default 5 or the file's value) and `concurrency` (1–16). Calls are written to the MCP audit log.

The CLI wraps the same tool for CI:

```sh
l8db --benchmark --connection <name|id> (--sql <SQL> | --file <path>) \
  [--repeats N] [--concurrency N] [--max-median-ms X]
```

It prints the JSON report on stdout. The report covers each statement's runs, errors, first error, min/median/p95/max/avg ms and throughput, plus the skipped statements. Connections come from the MCP configuration (`mcp.json`, or override with `L8DB_MCP_CONFIG`).

| Exit code | Meaning |
| ---: | --- |
| 0 | all statements measured without errors and within `--max-median-ms` |
| 1 | tool error, run errors, skipped statements or a median above the threshold (details on stderr) |
| 2 | invalid arguments or runtime setup failure |

## Tests

- Unit tests: `bun test tests/perf-test.test.ts tests/perf-load.test.ts tests/workload.test.ts` and `cargo test --lib mcp::benchmark` (includes SQLite end-to-end cases).
- Live database check: `L8DB_WORKLOAD_LIVE=1 bun test tests/workload-live.test.ts` builds the SQL in TypeScript, runs it through the real adapters via the ignored Rust test `live_plan`, and asserts statistics, timed runs and replay. `L8DB_WORKLOAD_LIVE_KINDS` selects families, and `L8DB_LIVE_<NAME>_URL` overrides each lab URL.
- Binary check: after `cargo build`, `L8DB_BENCHMARK_E2E=1 bun test tests/benchmark-cli-e2e.test.ts` exercises `--mcp` and `--benchmark` on the debug binary.
