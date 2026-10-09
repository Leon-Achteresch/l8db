# Performance tests, workloads and headless benchmarks

## Application performance gates

Every runtime feature needs a regression scenario, even when the feature is small. Reuse a relevant scenario and exercise a realistic large input, median/p95 latency, retained resources, and database request counts/concurrency when it reads data. Background features also need cancellation and idle checks. Run only the affected scenarios locally. The performance workflow runs the shared gates on pushes to `development` and pull requests to `development`/`main`.

```sh
bun run test:perf:core
bun run test:perf:browser --engine chromium
bun run test:perf:browser --engine webkit
bun run test:perf:constrained
bun run test:perf:database
```

Use `--filter '<test name pattern>'` with a core or browser command to run only affected scenarios, for example `bun run test:perf:browser --skip-build --filter 'palette'`. The report records the filter. `L8DB_PERF_DIST` selects an isolated production build for application fixtures during parallel work; serialize CPU-sensitive measurements so competing browsers do not distort the result.

An empty selection or an entirely skipped run fails the runner. `resources.json` records the number of actually passing/failing tests; process resource measurements alone cannot establish that a feature scenario ran.

Browser commands build once first; `--skip-build` reuses an existing production build. Install the repository's Playwright browsers before running them. The constrained suite uses Chromium with 4× CPU throttling and a 256 MiB V8 heap limit; its existing retained JS heap budget is 160 MiB. This limits the renderer's JavaScript heap, not the application's total memory. WebKit cannot emulate Chromium CPU throttling or supply the same heap metric, so the runner rejects that combination instead of reporting a successful skipped measurement. PostgreSQL tests use a disposable Docker lab with 3,000 tables and two million rows by default, test loading and statement/lock timeouts, and check that abandoned work does not leave idle transactions.

The CI matrix runs the core suite on Linux, macOS and Windows, plus Chromium UI tests on Linux/Windows and WebKit on macOS. The constrained Chromium profile runs on Linux. Actual runner architecture and hardware are recorded in each report. These browser tests use a mocked Tauri transport; the PostgreSQL lab separately exercises real Rust adapters. They do not measure a complete packaged Tauri application on every device or test every adapter. Native WebView versions, additional architectures, real low-memory machines, network latency and other database families remain separate validation targets.

Reports and logs are written to `test-artifacts/performance/` and uploaded as CI artifacts. `resources.json` records the Git revision/dirty state, platform, architecture, CPU, RAM, kernel, Bun version, profile, wall time and resource limits. Its run ID also appears in each scenario artifact, along with a capture timestamp; files left from another filtered run must not be attributed to the current measurement. CPU time and peak RSS are OS resource statistics for the **Bun test subprocess**, not the summed memory of a packaged application's browser/backend process tree. Grid reports additionally contain renderer heap and frame measurements. Missing process measurements and exceeded budgets fail the runner. The core runner allows 512 MiB peak RSS and 30 seconds of CPU time; browser runners allow 1 GiB and 600 seconds for their test harness. Per-feature timing/DOM/heap/request assertions are separate, much tighter checks. The native database job additionally records its revision, OS/architecture, CPU, RAM and Rust version in `native-environment.log`.

Bun is pinned to 1.3.10. Its [resource implementation](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/api/bun/subprocess/ResourceUsage.zig) exposes native `ru_maxrss`; the runner normalizes macOS bytes and Linux/Windows KiB, including the [Windows conversion](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/api/bun/process.zig). Revalidate the normalization when updating Bun.

### Data retention and database load

Inactive table pages and column/source searches share a per-window retention budget of **20 entries and 16 MiB of estimated data**. The oldest inactive results are discarded first. Active observers and in-flight reads stay intact; metadata and row counts keep their freshness windows and are outside this result budget. An oversized inactive result is discarded without evicting useful smaller results. Revisiting an evicted result fetches it again; eviction itself does not issue a query.

The estimate accounts for UTF-16 text, array slots, object/property overhead and binary buffers without creating a JSON copy. Traversal stops after 16,384 values or 32 nesting levels; results that cannot be sized within that work budget are not retained after their last observer leaves. This is a retention policy, not an exact measurement of engine heap or a total application RSS limit. Visible large results still require enough memory to display them.

`tests/perf-query-cache.test.ts` exercises 200 result pages, 64 simultaneous metadata consumers and cache pressure with a visible result. Request assertions require a single shared metadata read before explicit refresh and prohibit replacement reads caused by eviction. `tests/perf-virtual-row-model.test.ts` checks that resolving 40 visible row IDs in a 100,000-row result evaluates only those 40 IDs. Numeric IDs resolve directly; a custom ID for an uncached row builds a lookup index on demand. The row/visible-ID caches retain at most 512 entries.

On the shared Linux x64 VM (8 QEMU CPUs, 16 GiB RAM, Bun 1.3.10), the pre-change probe retained all 200 visited pages; the new gate retains 20 pages, estimated at 4.2 MiB for 100 rows of 1 KiB text per page. A lookup of one already-created row in a 100,000-row table previously evaluated all 100,000 IDs and took 82.5 ms; the same probe now evaluates one ID and took 0.12 ms. Those two lookup times are single samples, not percentiles. The separate warmed nine-run scenario resolving 40 visible IDs measured median 1.05 ms / p95 1.84 ms. Cached reads by 64 metadata consumers measured median 0.30 ms / p95 0.39 ms and issued one underlying request until explicit refresh. These measurements describe this VM and workload, not a hardware-independent speed guarantee.

The schema-object aggregator observes the existing table, view, function and procedure query keys, so fresh results and in-flight reads can be shared with other features. It starts at most two new metadata reads per query client and connection. This cap covers reads started by the aggregator; it is not a global limit on every database command. Closing its last reader releases child observers, discards queued reads and requests native cancellation for its dispatched PostgreSQL/SQLite jobs. Another feature's active observer preserves a shared read. Previously dispatched reads from other callers do not become cancellable retroactively. Drivers without confirmed cancellation keep their physical slots until the dispatched reads finish; reopening cannot replace those slots with additional concurrent work.

`tests/perf-schema-object-loading.test.ts` exercises 64 readers and 7,800 metadata objects with four underlying reads and maximum concurrency two. With an 8 ms simulated delay per read, the cold scenario measured median 28.22 ms / p95 34.65 ms; warm reuse measured 0.319 ms / 0.378 ms. Separate abandonment cases require two dispatched cancellations, zero dispatches for two queued reads, preservation of an independently observed read and bounded concurrency across 20 rapid reopens when cancellation is unsupported. These are transport simulations; real adapter evidence is reported separately.

The scoped Rust metadata tests passed on the same Linux VM with rustc 1.99.0. An actual SQLite catalog containing 3,000 tables and 1,000 views measured median 15.468 ms / p95 16.654 ms over nine runs after two warmups, with two catalog reads per run and 229,780 bytes of result vector/string capacity (gate: p95 below 250 ms, result capacity below 2 MiB). Cancellation delayed before adapter acquisition measured median 0.250 ms / p95 0.452 ms, started no catalog read and removed each tested job registration. This proves cancellation before a catalog read starts; the separately passing `db::sqlite::tests::cancellation_interrupts_only_its_query` exercises an actual running query interrupt and a successful follow-up query. Concurrent Rust compilation was present on this VM, so these catalog times are recorded workload observations rather than an isolated before/after comparison. PostgreSQL catalog cancellation still needs a dedicated live integration scenario for these new command wrappers; other families are not established by the SQLite tests.

### Additional scoped workloads and current limits

The following local measurements use the same Linux x64 VM and Bun 1.3.10. Browser samples use Chromium 153.0.8010.12 with 4× CPU throttling where shown. Throttling is simulation, not a result from a physical low-end computer. Nine measured runs follow two warmups unless the scenario states otherwise.

| Scenario | Workload and retained-work limit | Local median / p95 | Gate |
| --- | --- | --- | --- |
| SQL history previews | 100 previews from 196,001-character, 14,000-line statements; only first nonempty line scanned | 0.044 / 0.115 ms | 30 ms p95 |
| History timestamps | 5,000 entries, one reused date formatter | 6.28 / 8.77 ms | 50 ms p95 |
| SQL statement outline | 3,000 statements, 40 visible summaries created lazily; one cached input, at most 4,096 entries and one million SQL characters | 4.81 / 5.73 ms | 120 ms p95 |
| SQL outline reuse | 3,000 accesses to the same cached outline | 0.30 / 0.75 ms | 5 ms p95 |
| Virtual item measurements | 40 visible items from 100,000 rows; zero synchronous geometry reads | 0.025 / 0.045 ms | 10 ms p95 |
| Scroll container observation | 40 viewports, 80,000 resize notifications, 800 deliveries; at most one queued RAF per viewport, no idle or post-disposal deliveries | 17.28 / 25.28 ms | 100 ms p95 |
| Fresh palette scroll setup | 10,000 mock elements; zero initial native scroll writes, 40 subsequent writes; weak element references | 1.22 / 2.62 ms | 20 ms p95 |
| Segmented controls (4× CPU) | 50 controls × 10 choices; 1,107 DOM nodes; keyboard wrap and End verified | 11.1 / 20.3 ms | 120 ms p95 |
| Onboarding DOM changes (4× CPU) | 1,000 nodes inserted/removed per action; no retained nodes; ordinary and contained popup priority ends with the overlay | 47.3 / 98.3 ms | 120 ms p95 |
| History modal gesture boundary | 1,000 gesture/cancellation cycles with alternating inside/outside releases; at most 28 listeners and one queued RAF, zero retained listeners or idle frames | 11.74 / 17.68 ms | 50 ms p95 |
| Palette warm opens (4× CPU) | 3,000 tables, nine opens; at most 30 rendered options, no repeated metadata requests; three rapid exit/reopen cycles and 700×540 resize checked | 66.3 / 85.9 ms | 120 ms p95 |
| Palette inside history (4× CPU) | 5,000 history and 5,000 saved entries plus 3,000 tables; at most 15 palette options and 16 history rows; focus, hit testing, search, Escape and portal restoration | 71.4 / 105.7 ms | 120 ms warm p95; 1,000 ms cold |
| Buffered grid ranges | 5,000 viewport updates over 100,000 rows; one retained window, at most 40 indices, 626 changed windows | 1.17 / 2.04 ms | 20 ms p95 |
| Buffered column ranges | 5,000 updates over 100,000 columns with alternating partial edge visibility; at most 17 indices, 470 changed windows | 4.11 / 16.66 ms | 20 ms p95 |

The prior history-preview probe split every line and took 163.3 ms for 100 statements in a single sample; the new first-line scenario measured the percentiles above. The timestamp baseline created one formatter per entry and took 75.7 ms for 1,000 timestamps; its workload differs from the 5,000-entry warmed gate, so it is not a percentile comparison. Deterministic observer/scroll tests measure their test harness as well as helper work, and bound scheduled work rather than claiming measured application heap or actual DOM mounting time.

The modal boundary workload uses a mock document and animation-frame queue, with 500 delivered and 500 cancelled dismissals per measured run. It proves balanced listener/frame ownership and cancellation, not browser modal-opening latency. Separate core regressions and real-DOM checks in Chromium/WebKit verify that an outside pointer gesture released or cancelled inside cannot leave subsequent context-menu input blocked. The onboarding browser gate additionally checks that a contained history host receives z-index 10,000,003 only while the actual overlay exists and returns to its normal 50 after the exit completes.

The disposable PostgreSQL lab passed its loading and timeout/cancellation checks with 3,000 tables and two million rows. Loading the first 100 unsorted rows took about 6 ms, while sorting an unindexed name took about 506 ms and sorting with a one-million-row offset about 3,800 ms. Exact counts took about 89 ms (194 ms filtered), versus about 14 ms (38 ms filtered) for a 100,000-row cap. These are workload probes, not a guarantee for arbitrary queries. Cancellation/timeout tests require abandoned work to leave no idle transactions. Other families, native packaged application RSS, macOS/Windows hardware and additional architectures have not been established by this lab.

Coverage remains incomplete. The runner lists shared cache/grid tests and selected application interactions; it does not establish performance for every registered user-facing feature. Generic route mounting or functional tests do not cover a feature's individual edit, export, upload, background, or cancellation paths. Separate scenarios and resource/request measurements remain required for uncovered BaaS/storage operations, automation, versioning, AI, multi-window behavior and other feature paths. CI configuration is a validation plan until its reports exist.

The core runner also includes the local usage-statistics scenarios: 100,000 events with bounded aggregation and a single deferred write, 32 retained window sessions, disposal with no idle reads/writes, and bounded statistics-view output. Their subprocess reports describe local aggregation and server-rendered markup, not browser interaction latency or a live database workload.

The palette previously measured median 165.4 ms / p95 219.5 ms in the same 3,000-table, 4× CPU workload. Its shared asynchronous container observer, skipped initial zero scroll write, contained stable body portal and memoized inactive header avoid repeated rendering and application-wide layout work. The latest plain-palette scenario measured median 66.3 ms / p95 85.9 ms and 1.30 MiB retained heap growth, with no repeated metadata reads (run `40d5a700-0f3c-496a-9df6-b52fd85ddcbf`). It verifies three same-DOM reopen cycles from the 60th logical result back to cursor/scroll zero, plus visibility of that result after a 700×540 resize. The command module loads once on demand; closing before its response prevents abandoned rendering and starts no metadata read during module loading. The separate cancellation scenario passes with two dispatched cancellations, no dispatch for two queued reads, maximum concurrency two and no remaining warm/idle reads or jobs.

The plain palette scenario passed WebKit 26.6 on this Linux VM at median 50 ms / p95 71 ms without CPU throttling (run `cb949780-3022-49d4-adfc-48eea652926b`). WebKit retained heap was not measured. This is browser-engine evidence, not a macOS native WebView or physical Mac result. Separate process CPU samples identify competing work during a run; they are observations, not controlled hardware comparisons. Failed or contended artifacts remain available and must not be replaced by an unrelated passing scenario.

The affected palette-in-history scenario passed after the containing history host changed: Chromium at 4× CPU measured median 73.2 ms / p95 98.4 ms, cold open 366 ms including first module/metadata loading, and 117,376 bytes retained heap growth (run `e9a762c5-e815-43c6-aaaf-1795ec06263c`). The earlier 130.8 ms warm p95 failure remains a separate artifact. WebKit measured 34/39 ms and 161 ms cold (run `9474aef0-94cb-425b-904d-33adba4e6c11`). After the scoped history wrappers switched to direct React portals, the affected follow-up also passed: Chromium median/p95 71.4/105.7 ms, cold 372 ms and 107,252 bytes heap growth; WebKit 38/48 ms and 172 ms cold, with no heap metric. These follow-ups used direct Bun runs without a runner ID. All checks require zero warm/idle database reads, one returned portal host and no retained dialogs. This covers the global palette in the history panel; opening it inside an already-open transfer dialog remains a separate focus/Escape coverage gap.

An integrated 77-test core run passed 76 tests but exceeded the buffered-row range gate at p95 26.53 ms. Removing an unnecessary Set and sort from the unpinned range path reduced its separate nine-run median/p95 to 1.17/1.80 ms, preserving the 20 ms gate, 626 changed windows, maximum 40 indices and zero idle allocations (run `842292f7-5625-40b9-af66-085318adca01`). The final scoped five-test range check also passed, measuring row median/p95 1.17/2.04 ms and column 4.11/16.66 ms; it was a direct Bun run without a runner ID. The other core checks were not repeated. The integrated subprocess peaked at 264 MiB RSS and used 4.74 seconds of CPU; its resource pass does not erase the feature timing failure.

The result-grid fixtures passed their existing frame gates on Chromium with 5,000 rows and 13, 50 or 121 columns after buffering render windows, measuring one representative uniform-height row and reducing the result lookahead to 128 pixels. All scroll directions reached at least 59 FPS; p95 frame time was at most 16.8 ms and the worst frame 33.3 ms. Mount probes were 146/169/225 ms, with 32 rendered rows and 449/321/321 cells. Renderer heap snapshots were 23.4/40.1/45.2 MiB; these snapshots do not prove retained growth or total native process memory. Coverage included font sizes 10/20, scales 80/100/150, all three densities, viewport resizing and scroll-to-end/reverse behavior.

The final editable-table fixtures also passed Chromium with 5,000 rows and 50/121 columns (run `1bd8eee6-6089-487e-a065-74d19927dffe`) and a 13-column foreign-key table (run `27c7b80b-620e-4d31-a63e-0ecd2e99d1bc`). Vertical, horizontal and diagonal scrolls measured approximately 60 FPS, with p95 and worst frames at most 16.8 ms. The separate 1,000-row, 60-column sizing scenario measured median/p95 74.7/109.9 ms at compact 80% scale, 68.5/78.0 ms at normal 100%, and 40.8/53.3 ms at spacious 150%, preserving the 120 ms gate. Normal rows use one resize-observer target; an expanded editor uses at most two. Cold editing reads constraints and enum options once each; measured warm scrolling and idle intervals issue no database reads, and observer delivery stays idle and ends on navigation away. Initial application metadata loading is outside these warm request intervals and is not subject to a global concurrency-two guarantee.

Repeated result replacement now stages a focused filter's removal until it can blur with React events enabled, before the replacement paints. The lifecycle scenario makes 12 replacements across 5,000-row results with 13/50/121 columns and then clicks a visible close button while a filter is focused. Chromium measured median/p95 71.3/160.6 ms against its 1,000 ms gate, retained heap growth 4.60 MiB against 16 MiB, and 2.88 MiB above the empty baseline after closing against 8 MiB. Post-GC DOM growth was six nodes; event listeners grew by 13 while mounted and ten after closing. Database reads, idle frame requests and observer targets after closing were zero. This user-triggered close is the tested disposal path; earlier failing direct React-root unmount artifacts remain separate evidence, not a passing claim for every removal path.

WebKit 26.6 passed the same result lifecycle at median/p95 114/127 ms, bounded at 736 DOM nodes and 534 cells, with zero database reads, idle frames or remaining observer targets (run `e108a487-25d5-4644-86dc-d0516ff9e9ae`). Heap and detached-node counters are unavailable in this engine. Its row-height run remains red: compact 80% scale measured 165/215 ms, with a 159 ms font reflow, and normal-scale font reflow took 124 ms, exceeding the unchanged 120 ms gate. Normal scroll p95 was 105 ms and spacious scroll p95 79 ms. Profiling attributed most remaining work to renderer style recalculation; passing bounded DOM, observer cleanup and request checks does not erase those latency failures.

History latency remains an optimization target. Its request reports separate database commands from other Tauri IPC and compare a fresh idle interval, rather than counting the entire interaction sequence as idle database traffic. The final startup barrier waits for tables/columns/functions/procedures and no active metadata request, so delayed SQL-autocompletion startup reads are not attributed to a dialog. The corrected WebKit history/transfer run completed 107 functional assertions, with zero operation/idle database or unknown commands, but history median/p95 214/394 ms and export 87/156 ms still exceeded 120 ms. Import measured 25/57 ms.

The final Chromium history diagnostic also recorded zero operation/idle database or unknown commands and bounded 16 rows/1,325 DOM nodes, but warm median/p95 245.5/303.5 ms remained above the gate. Its cold 478 ms sample included timeline tracing and CPU sampling and is not an uninstrumented baseline. The trace identifies autofocus as a synchronous caller of style recalculation for 174 new elements and layout. Remaining Radix animation-name style reads occur during the outgoing close lifecycle; their exact DOM identity is not established. Neither trace establishes that broader parent-render isolation would help. Earlier failed and closed-page artifacts remain separate evidence.

Import coverage currently validates one candidate against 5,000 saved entries; importing a 5,000-entry file still needs a separate bounded-rendering and resource gate. Immediate reopen, route unmount and editor-focus preservation after loading SQL also need dedicated coverage beyond the tested ordinary close/reopen cycles.

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
- Live database check: `L8DB_WORKLOAD_LIVE=1 bun test tests/workload-live.test.ts` builds the SQL in TypeScript, runs it through the real adapters via the ignored Rust test `live_plan`, and asserts statistics, timed runs and replay. `L8DB_WORKLOAD_LIVE_KINDS` selects families, and `L8DB_LIVE_<NAME>_URL` overrides each lab URL. `bun run test:workload-live` starts the lab containers in batches (light families together, then Oracle, Cassandra and SQL Server each alone so SQL Server keeps its plan cache) and removes them afterwards; `L8DB_WORKLOAD_BATCHES` selects batches.
- Binary check: after `cargo build`, `L8DB_BENCHMARK_E2E=1 bun test tests/benchmark-cli-e2e.test.ts` exercises `--mcp` and `--benchmark` on the debug binary.
