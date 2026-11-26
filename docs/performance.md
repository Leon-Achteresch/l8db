# Performance tests, workloads and headless benchmarks

## Deep PostgreSQL and Oracle pages

Measured on 2026-11-25. Each fixture held two million rows, a numeric primary key on `id`, an ascending B-tree on `(name, id)` and a non-null text name. PostgreSQL 17.11 ran natively on macOS. Oracle AI Database 26ai Free 23.26.3 ran locally in Docker with the native macOS Oracle client. The fixtures, including indexes, occupied 333 MiB and 515 MiB respectively. Hardware was an Apple M3 with 16 GiB RAM, macOS 27.2.1 arm64, Rust 1.99.0 and Bun 1.3.10. The desktop was shared with other applications and some samples overlapped compilation. Neither CPU nor heap was throttled.

The table shows median / p95 milliseconds for the production Rust adapters over loopback, including metadata reads, data transfer and row conversion. Each operation returned 100 rows after position 1,000,000. Both revisions used the same running database, index definitions and data. Each series had one warmup and 21 measured requests in the Rust test profile. The old adapter at `1a64c6de` used the same offset query for jumps and next pages. The new benchmark alternates jumps and next pages. It obtains the preceding page outside the timers and compares every column, row, row marker and position with the absolute result. SQL-only spot checks also compared old and new ordered results. Tauri IPC, WebView rendering, remote databases, other providers and older Oracle releases were outside this experiment.

| Database and order | Before | Jump now | Next page now |
| --- | ---: | ---: | ---: |
| PostgreSQL, ID ASC | 245.47 / 265.41 | 25.91 / 27.34 | 1.95 / 2.31 |
| PostgreSQL, ID DESC | 244.34 / 258.33 | 26.04 / 29.44 | 1.91 / 2.39 |
| PostgreSQL, NAME ASC, ID ASC | 885.19 / 902.75 | 37.78 / 41.93 | 1.98 / 2.24 |
| PostgreSQL, NAME DESC, ID ASC | 1,125.92 / 1,613.30 | 97.49 / 102.49 | 2.06 / 2.48 |
| Oracle, ID ASC | 223.76 / 305.69 | 87.75 / 97.71 | 2.91 / 3.49 |
| Oracle, ID DESC | 482.31 / 708.43 | 90.11 / 95.98 | 3.13 / 4.09 |
| Oracle, NAME ASC, ID ASC | 3,424.65 / 4,671.42 | 139.55 / 148.92 | 3.75 / 5.11 |
| Oracle, NAME DESC, ID ASC | 3,833.72 / 6,408.34 | 246.45 / 278.12 | 4.35 / 9.40 |

In a separate alternating old/new SQL comparison, ascending name jumps on PostgreSQL took 888.97 / 954.17 ms before and 44.36 / 53.32 ms after (server execution time). On Oracle the same comparison measured 2,827.25 / 3,114.04 ms before and 113.23 / 121.89 ms after (thin client on loopback fetching all 100 rows).

From offset 4,096, eligible unfiltered jumps of up to 1,000 rows read narrow keys first and load the displayed rows afterwards. PostgreSQL uses verified primary keys on ordinary heaps without inheritance or row-level security. Oracle uses ROWIDs. For mixed Oracle ordering (`name DESC, id ASC`) a visible ascending composite index lets the adapter read the page's names and keys backwards. It then obtains each name's selected IDs in ascending order, accounting for groups that cross a page boundary. A separate live test exercises a group of 5,000 equal names, two group boundaries in one page, a partial last page and an empty result.

Forward navigation uses the last visible key of an already loaded, complete, fresh preceding page. The database validates the key type and current columns. A usable boundary requires one numeric primary key representable exactly in JavaScript and either key ordering or a supported non-null text sort. Data changes between requests follow the last displayed key. Filters, views, active transactions, stale pages and refreshes use absolute positioning. Oracle binds text with the column's character type. On the ascending name fixture, the execution plan changed from an index full scan with a character conversion to an index range scan. Cache lookup makes zero database requests and creates zero query entries. A sparse or unindexed sort, a cold disk or network latency can still dominate.

Run `scripts/test-load-perf.sh` for the PostgreSQL fixture. It adds the composite index after its unindexed workloads. For an existing disposable database, use `L8DB_PERF_PG_URL` or `L8DB_PERF_ORACLE_URL` and run the corresponding `cargo test --lib deep_forward_postgres -- --ignored --nocapture` or `cargo test --lib deep_forward_oracle -- --ignored --nocapture` from `src-tauri`. Forward p95 must stay below 20 ms and jump p95 below 300 ms on the indexed fixture. The Oracle tie test runs with `cargo test --lib deep_mixed_page_ties -- --ignored --nocapture`. For Oracle, connect as the owner of a dedicated, empty `L8DB` schema with the native client available and provision this fixture once.

```sql
CREATE TABLE big (id NUMBER PRIMARY KEY, name VARCHAR2(32) NOT NULL, payload VARCHAR2(120));
INSERT INTO big
SELECT LEVEL, RAWTOHEX(STANDARD_HASH(TO_CHAR(LEVEL), 'MD5')), RPAD('x', 120, 'x')
FROM dual CONNECT BY LEVEL <= 2000000;
COMMIT;
CREATE INDEX big_name_id ON big (name, id);
BEGIN DBMS_STATS.GATHER_TABLE_STATS(USER, 'BIG', cascade => TRUE); END;
/
```

## Building the SQL editor catalog

The completion index processes table and column metadata in short slices, shares completed indexes across editor contexts with identical metadata arrays and discards unfinished work when the registry changes or its last editor closes. Preparing completions and opening an already prepared list requires no further catalog request.

| In-memory catalog of 20,000 tables and 400,000 columns | Before median / p95 | After median / p95 |
| --- | ---: | ---: |
| PostgreSQL, fresh metadata | 23.72 / 28.14 ms | 15.19 / 19.45 ms |
| Oracle, fresh metadata | 36.43 / 54.57 ms | 15.23 / 16.22 ms |
| PostgreSQL, new context sharing the metadata | 17.92 / 25.68 ms | 0.82 / 0.91 ms |
| Oracle, new context sharing the metadata | 18.96 / 29.20 ms | 0.81 / 0.86 ms |

These are synchronous build times using two schemas with overlapping table names and 20 shared field names. Both revisions used the same Bun workload with two warmups, 21 samples, new metadata arrays before each cold sample and GC outside the timer. The subsequent unqualified SELECT completion took 0.08 ms p95 for PostgreSQL and 0.10 ms for Oracle. The measurements start after the metadata is available in memory. Frame scheduling can extend elapsed time to a completely prepared catalog.

The scoped regression also mixes two column types per shared name and checks cancellation, reuse and retained heap. Under concurrent compilation its cold p95 was 35.03 ms for PostgreSQL and 44.24 ms for Oracle (80 ms limit). Individual preparation slices measured 2.79 and 2.46 ms p95 (15 ms limit). Reused contexts measured 2.06 and 1.89 ms p95 (6 ms limit). Twenty additional preparations retained 0.64 MiB after GC for each dialect (4 MiB limit). The boundary lookup in the row cache measured 0.066 ms p95 over 51 requests with no database traffic (3 ms limit).

Reproduce the editor and cache regressions with `bun test tests/perf-sql-intellisense.test.ts tests/perf-page-boundary.test.ts`. The virtual scroll workload in `tests/perf-rows-window.test.ts` also checks that scrolling across a 10-million-row range holds at most two requests in flight and idle scrolling issues no requests.

## Large catalogs and filtered row counts

The SQL editor groups tables, views and columns by case-insensitive name. Lookup preserves the first matching relation in catalog order and checks the schema when resolving a qualified name. Hover, definition lookup, JOIN suggestions and completion share indexes keyed by the metadata arrays. Replacing an array after a metadata refresh rebuilds its index on demand.

The SQLite table browser stops counting after the first 100,001 matches of a builder filter, including within an open transaction. Up to 100,000 matches it returns the exact count. Larger results use the existing lower-bound display and exact-count action. Plain unfiltered counts keep SQLite’s native count operation. Raw SQL filters keep their existing aggregate semantics. A sparse unindexed predicate can still read the entire table before reaching the limit.

Run the editor workload with `bun test tests/perf-sql-intellisense.test.ts` and the SQLite workload with `cargo test --release --lib filtered_count_large_table_budget -- --ignored --nocapture` in `src-tauri`. The editor test alternates target tables across 51 measured lookups, checks the resolved type against a same-named table in another schema, and limits retained heap growth across another 100 lookups to 2 MiB. The SQLite test exercises a real in-memory adapter, returns one aggregate per query, and interrupts a separate probe if the query executes two million SQLite VM instructions.

Measured on 2026-11-25 on macOS 27.2.1, arm64, Apple M3, 16 GiB RAM, Bun 1.3.10 and Rust 1.99.0. The machine was shared with desktop applications and compiler processes. No CPU or heap throttling was applied.

| Workload | Before, median / p95 | After, median / p95 |
| --- | ---: | ---: |
| Resolve and format a qualified column hover, prepared synthetic catalog of 20,000 tables and 400,000 columns | 23.13 / 46.37 ms | 0.10 / 0.23 ms |
| Filter 100,000 completion candidates for 300 prefix matches | 11.40 / 17.91 ms | 0.033 / 0.086 ms |
| Count a 50% matching unindexed builder filter, 2 million file-backed SQLite rows | 70.11 / 102.16 ms | 8.87 / 12.71 ms |

For the editor comparison both revisions ran in the same process against identical input, alternating the execution order over 51 samples after two warmups. The hover timings cover scope parsing, symbol lookup and Markdown generation. The 3 ms p95 gate applies after warmup. Retained JS heap changed by −22,779 bytes after GC. Under heavier compiler load the standalone hover regression test measured 0.12 / 0.77 ms and the new prefix gate measured 0.06 / 0.94 ms. Cold completion-index construction measured 423 ms before and 351 ms after in a separate alternating seven-sample median comparison. It remains expensive, and these timings exclude WebView paint.

The real SQLite adapter test with two million in-memory rows measured **5.61 ms median / 9.12 ms p95 in release**, against a 30 ms p95 gate. The debug build measured 19.23 / 26.53 ms. The statement completed within the two-million-instruction budget. Both the empty result and exactly 100,000 matches were exact. The transaction test verified the lower bound against uncommitted writes.

The file-backed measurement alternated the old and new SQL against the same local SQLite 3.54.0 database, with two warmups and 21 samples per query. The exact query returned 1,000,000. The capped query returned the lower bound 100,001. These SQL-only measurements exclude IPC. The virtual grid tests also measured 40 visible ID lookups out of 100,000 rows at 0.48 / 3.60 ms. During 6,000 simulated scroll frames over a 10-million-row extent, the planner requested 182 pages and held at most two requests in flight and 200 rows in its active window.

The completion-prefix scenario places 100 fuzzy matches before the first prefix match. Once the 300 prefix results and truncation are known, the search returns. It visits 400 candidates versus 100,000 before. Its regression budget is 3 ms at p95. When fewer prefixes match, it still scans to the end so later candidates can outrank earlier fuzzy matches.

The PostgreSQL workload now measures 21 samples after one warmup for each operation, including the deep page previously timed only once. A temporary local PostgreSQL 17.11 instance ran the dataset from `scripts/test-load-perf.sh` with 3,001 tables, 400 views, 2,000,000 rows in `big` and a database size of 328 MB. The Rust test profile used the real adapter over loopback.

| PostgreSQL operation | Median | p95 |
| --- | ---: | ---: |
| Open large table, five parallel adapter operations | 23.84 ms | 67.71 ms |
| First 100 rows, default order | 5.41 ms | 9.68 ms |
| First 100 rows, indexed ID order | 7.44 ms | 15.20 ms |
| First 100 rows, unindexed name order | 740.10 ms | 1,244.38 ms |
| Default order, offset 1,000,000 | 570.00 ms | 984.84 ms |
| Unindexed name order, offset 1,000,000 | 2,814.67 ms | 7,492.42 ms |
| Exact filtered count | 115.72 ms | 129.56 ms |
| Capped filtered count | 26.14 ms | 30.50 ms |
| Detailed columns for one table | 2.50 ms | 3.01 ms |
| List 3,001 tables | 16.89 ms | 20.28 ms |

The plan for a deep unindexed name sort used a parallel sequential scan, sort and gather merge before the limit. Database latency and deep paging depend on the available indexes, sort order and number of skipped rows. A separate server-side experiment on PostgreSQL 17.11 gave the same two-million-row table a composite index on `(name, id)`. Both queries returned the same ordered 100 IDs. With the preceding row's key already known, `WHERE (name, id) > ($last_name, $last_id) ORDER BY name, id LIMIT 100` measured 0.372 ms median / 3.096 ms p95. On that indexed fixture, `OFFSET 1000000` measured 5,906 / 7,694 ms. Each query had one warmup and 21 samples using `EXPLAIN (ANALYZE, TIMING OFF)`. Anchor discovery, network time and rendering are excluded. At the time of that baseline the app used offset pagination for every page. The deep-paging measurements above cover the subsequent implementation.

The measurements cover one Mac and local SQLite and PostgreSQL. Remote latency, other database families, Windows, Linux and end-to-end WebView latency remain unmeasured in this run.

## Workspace motion

Start the local Vite dev server, then run the scoped checks:

```sh
bun test tests/change-animation.test.ts
L8DB_MOTION_ENGINE=chromium L8DB_MOTION_BROWSER_URL=http://127.0.0.1:1420 bun test tests/perf-workspace-motion.test.ts
```

`ChangeSurface` animates an existing content container without remounting its children. A new view replaces the previous animation, ordinary rerenders do not restart it, and finishing, unmounting, hiding the document or changing the motion preference releases the effect and its listeners. Views travel horizontally and settle over 420 ms. Settings sections animate at most six rows with 28 ms offsets; discovery stops after 256 visited elements. Delayed rows use backwards fill so they do not flash at their final position before starting. Reduced motion uses one 100 ms opacity transition without translation or stagger.

Shared tab strips and app navigation use scoped spring highlights. The transaction inspector slides over the canvas instead of resizing the data grid on every open/close, and becomes inert immediately on exit. Dialogs arrive over 420 ms with bounded blur and scale, popovers settle over 340 ms, and successful workspace messages draw and stamp their check icon once. None of these transitions starts database work or polling.

The content scenario uses 400 rows × 24 columns (9,600 cells, 10,036 DOM nodes), 180 measured view changes and 1,000 immediate replacements. Limits remain setup median below 4 ms / p95 below 12 ms and next-frame latency p95 below 80 ms, at most one content animation, zero retained DOM growth, zero effects after cancellation or idle, and zero database calls. It also verifies input/cell identity, keyboard selection, reduced motion, light/dark rendering, a 960 px viewport and unmount cancellation. A panel geometry assertion requires a 380 px inspector while the content canvas keeps its width. A separate 500-row settings workload performs 100 replacements with at most seven effects (one container and six rows), p95 setup below 12 ms, and no retained effects after completion or cancellation.

A second browser workload mounts 50 independent tab strips with 500 options. It performs 100 confirmed selections using mouse-down events, checks keyboard navigation and the line-style indicator, and requires p95 input-to-two-frame latency below 120 ms, exactly 50 retained highlights, zero DOM growth and zero mutation writes over 150 ms after settling. Checking the actual selected state prevents a synthetic click with no Radix mouse-down behavior from becoming a false performance measurement.

Measured on 2026-11-09 with macOS 27.0.1, arm64, Apple M3, 16 GiB RAM, Bun 1.3.10 and Playwright Chromium 156.0.8078.4: content setup median **2.40 ms**, p95 **3.70 ms**; next-frame latency median **16.70 ms**, p95 **17.40 ms**. The previous, simpler motion baseline was 1.80 / 2.40 ms setup and 16.70 / 17.60 ms next-frame latency. The settings scenario measured 0.00 / 0.20 ms setup at the browser timer's precision, with seven effects at peak. Tab selections measured **33.30 / 34.20 ms** including two animation frames, retaining 662 nodes and 50 highlights. Every scenario had zero retained DOM growth, idle effects/writes and additional database calls. These are resource and latency observations, not a claim that more animation is an optimization. DOM/effect counts establish bounded retained work; they are not a process-memory measurement.

No CPU throttling or heap simulation was used. WebKit remains untested because the required local `webkit-2370` Playwright executable is missing; omit `L8DB_MOTION_ENGINE` to request both engines when installed. Packaged Tauri WebViews, Windows, Linux, other physical hardware and real database families were not exercised. The full-app recording fixture uses the real app with prepared demo transport responses; recordings demonstrate navigation, tabs, settings, panels and dialogs, but do not establish real database performance.

## Saved password restoration

`bun test tests/perf-secret-save.test.ts` covers saving secrets and restoring missing database passwords before opening a password prompt. The restoration scenario keeps 1,000 connections in the store and restores the last 60, using a mocked Tauri transport with 1 ms read latency. The previous prompt predicate classified all 60 as requiring manual entry despite saved passwords; restoration now needs zero prompts.

Measured on 2026-11-04: Linux 6.12.111+deb13-amd64, x64, QEMU Virtual CPU version 2.5+, 16 GiB RAM, Bun 1.3.10. Cold restoration measured 2.86 ms median / 6.75 ms p95; subsequent checks measured 0.016 ms median / 0.023 ms p95. Budgets are 50 ms cold p95, 5 ms warm p95 and 8 MiB retained heap; measured retained heap was 223,040 bytes. Cold restoration makes exactly one keychain read per selected connection, warm checks make none, with one read in flight and zero database requests. Cancelling while a keychain read remains blocked settled in 0.27 ms against a 250 ms limit and left no prompt; the native read may finish later. A 25 ms idle period must issue no additional reads. Native keychain availability, packaged WebViews, macOS and Windows are not covered by this mocked transport measurement.

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

Browser commands build once first; `--skip-build` reuses an existing production build. Install the repository's Playwright browsers before running them. The constrained suite uses Chromium with 4× CPU throttling, calibrated as described under [CPU throttling calibration](#cpu-throttling-calibration), and a 256 MiB V8 heap limit; its existing retained JS heap budget is 160 MiB. This limits the renderer's JavaScript heap, not the application's total memory. WebKit cannot emulate Chromium CPU throttling or supply the same heap metric, so the runner rejects that combination instead of reporting a successful skipped measurement. PostgreSQL tests use a disposable Docker lab with 3,000 tables and two million rows by default, test loading and statement/lock timeouts, and check that abandoned work does not leave idle transactions.

The CI matrix runs the core suite on Linux, macOS and Windows, plus Chromium UI tests on Linux and WebKit on macOS. There is no Windows UI job: with Bun 1.3.10 on Windows, Playwright cannot reach a launched browser because Bun child processes get no extra pipes for `--remote-debugging-pipe`, and `connect` to a Node-hosted Playwright server never completes its WebSocket handshake under Bun. Every earlier Windows UI run timed out without measurements. The constrained Chromium profile runs on Linux. Actual runner architecture and hardware are recorded in each report. These browser tests use a mocked Tauri transport; the PostgreSQL lab separately exercises real Rust adapters. They do not measure a complete packaged Tauri application on every device or test every adapter. Native WebView versions, additional architectures, real low-memory machines, network latency and other database families remain separate validation targets.

Reports and logs are written to `test-artifacts/performance/` and uploaded as CI artifacts. `resources.json` records the Git revision/dirty state, platform, architecture, CPU, RAM, kernel, Bun version, profile, wall time and resource limits. Its run ID also appears in each scenario artifact, along with a capture timestamp; files left from another filtered run must not be attributed to the current measurement. CPU time and peak RSS are OS resource statistics for the **Bun test subprocess**, not the summed memory of a packaged application's browser/backend process tree. The core suite starts one subprocess per test file and checks every file separately. The runner first measures the start-up cost of an empty test process (median of five samples) and subtracts it from each file's CPU time; peak RSS is not adjusted. Every file is listed with its raw and budgeted measurements and exit code, and a violation names the file and its value, for example `tests/x.test.ts: CPU budget exceeded: 8.40 s > 8.00 s`. `resources.json` also keeps the start-up cost, the raw CPU sum (`resources`), the sum of the budgeted values (`budgetedResources`) and the most expensive file (`mostExpensiveFile`); the sums are information, not gates. The connection import workloads are split over two files because a full `Bun.gc(true)` after the DBeaver and Navicat scenarios crashed Bun 1.3.10 on Windows, while each half runs reliably on its own. Running all files in one process measured accumulated heap growth across unrelated tests instead of any single workload (785 MiB on macOS, 513 MiB on Linux) and let a Bun 1.3.10 segmentation fault on Windows end the whole suite. Grid reports additionally contain renderer heap and frame measurements. Missing process measurements and exceeded budgets fail the runner. Every suite reruns tests that failed twice more with an exact name pattern (the core suite per failed file); a failure stands unless both reruns pass, so a test needs two of three attempts (the median) within its budgets. The same CI revision measured, for example, 99 and 127 ms for the navigator cold open and 182 and 235 ms for the history cold open, so a single attempt is within runner noise for several budgets. A rerun only counts when it executed exactly the repeated tests. The core suite adopted the reruns after run `41039625230` on `521c8f0c` failed on macOS (Apple M1 virtual) only because `tests/perf-versioning-review.test.ts` measured one structure-summary p95 of 21.09 ms against 20 ms. Reruns do not change any budget; `resources.json` lists the initial failures, every attempt and the confirmed failures. The core runner allows 512 MiB peak RSS and 8 seconds of budgeted CPU time per file; browser runners allow 1 GiB and 600 seconds for their whole test process. The former 30-second limit applied to the core sum, which grew with every added test file: run `41025250339` on `4308a83e` summed 36.1 s on macOS (Apple M1 virtual), 42.8 s on Linux and 49.6 s on Windows (both AMD EPYC 7763), while its most expensive file, `tests/perf-ui-plugins.test.ts`, used 3.2/4.3/5.2 s after subtracting the start-up cost and peak RSS stayed at 341–412 MiB. The per-file limit leaves about 1.5× headroom over the slowest runner's most expensive file and flags the workload that regressed instead of the number of files. With this limit, core run `41035527409` passed on all three systems: the most expensive file was again `tests/perf-ui-plugins.test.ts` with 2.15 s on macOS (Apple M1 virtual, 3 CPUs, 7 GiB), 4.16 s on Linux (AMD EPYC 7763, 4 CPUs, 16 GiB) and 3.89 s on Windows (AMD EPYC 9V74, 4 CPUs, 16 GiB); the budgeted sums were 23.5, 43.0 and 39.2 s and peak RSS stayed at or below 459 MiB. A local run on a MacBook Air (Apple M3, 16 GiB, macOS 27.0.1) kept the largest file at 2.2 s but exceeded the unchanged RSS limit with `tests/perf-dashboard-bi.test.ts` at 515–521 MiB in three runs; the CI runners measured 341–412 MiB for that file. Per-feature timing/DOM/heap/request assertions are separate, much tighter checks. The native database job additionally records its revision, OS/architecture, CPU, RAM and Rust version in `native-environment.log`.

Bun is pinned to 1.3.10. Its [resource implementation](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/api/bun/subprocess/ResourceUsage.zig) exposes native `ru_maxrss`; the runner normalizes macOS bytes and Linux/Windows KiB, including the [Windows conversion](https://github.com/oven-sh/bun/blob/bun-v1.3.10/src/bun.js/api/bun/process.zig). Revalidate the normalization when updating Bun.

### CPU throttling calibration

`Emulation.setCPUThrottlingRate` slows Chromium relative to the runner's own CPU, and GitHub assigns `ubuntu-24.04` jobs to different processors. Without calibration, the same nominal 4× meant different absolute speeds. At revision 154bc156, the first constrained attempt failed 15 targets on an AMD EPYC 9V45 runner, but 21 on an EPYC 9V74 and 22 on an EPYC 7763 runner. The additional failures (`/`, `/compare`, `/connections`, `/monitor`, `/sessions`, dashboard scrolling and first chart click, proxy user menu, sidebar toggle on `/` and sidebar scrolling) depended only on the runner.

Before the browser and constrained suites start, `scripts/test-performance.ts` runs `bun scripts/performance-report.ts` in a separate process. It launches the same Playwright Chromium without throttling and times a deterministic JavaScript workload in a blank page (`cpuBenchmark`): 20,000 row objects are sorted and aggregated in a map, 2,000 of them make a JSON round trip, all names are scanned with a regular expression, and a 9,841-node tree is built and walked; each sample repeats this six times. Three warm-up samples are discarded; the median of the next nine is the runner's benchmark time. The measurement takes about 1–3 s including the browser start. Every throttled test sets its rate with `cpuThrottleRate(nominal)`, which applies `max(1, nominal × reference / benchmark)` rounded to two decimals, so every runner runs as slowly as the reference runner at the nominal rate. A runner slower than this target cannot be sped up and runs at rate 1. Test names, budgets and budgets derived from the rate keep the nominal rate, and resetting the rate to 1 after a measurement is not calibrated. The runner passes its measurement to the tests in `L8DB_PERF_CPU_CALIBRATION`; a throttled test file started directly with `bun test` measures once per process instead, at its first throttling call. The runner itself must not load Playwright: when it measured in its own process, Bun 1.3.10 on Linux never reported the end of the following test process, and the constrained job hung after its first attempt until the job timeout.

`resources.json` records `cpuCalibration` (median, the nine samples, reference, CPU model and Chromium version); the constrained suite also records its nominal `cpuRate` and the `appliedCpuRate`. In the browser suite every throttled test sets its nominal rate itself, so its rates appear per test: scenario reports that contain a `cpuRate` add `appliedCpuRate` and `cpuCalibration`, and every throttling call logs a `performance cpu-throttle:` line with the nominal rate, the applied rate and the calibration.

The reference of **59.4 ms** is the median benchmark time of the fastest runner type, AMD EPYC 9V45. It comes from 44 calibration-only dispatches of the performance workflow (`-f job=throttle -f filter=calibration-only-<n>`, a pattern that matches no test) on 30 October 2026 at revision 154bc156, with Chromium 153.0.8010.12 and Bun 1.3.10. GitHub assigned the CPUs at random:

| Runner CPU | Runs | Benchmark medians | Median | Applied rate for 4× |
|---|---|---|---|---|
| AMD EPYC 9V45 | 9 | 56.9–65.2 ms | 59.4 ms | 4.00 (3.64–4.18) |
| AMD EPYC 9V74 | 11 | 69.0–76.5 ms in 9 runs, 94.3 and 94.9 ms in 2 | 74.0 ms | 3.21 (2.50–3.44) |
| Intel Xeon 6973P-C | 1 | 76.9 ms | 76.9 ms | 3.09 |
| AMD EPYC 7763 | 16 | 83.2–92.8 ms | 89.2 ms | 2.66 (2.56–2.86) |
| Intel Xeon Platinum 8573C | 3 | 83.2–94.0 ms | 93.9 ms | 2.53 (2.53–2.86) |
| Intel Xeon Platinum 8370C | 4 | 94.3–99.0 ms | 96.8 ms | 2.45 (2.40–2.52) |

Within one run, the slowest of the nine samples was 6–33 % above the median (median 12 %). VMs with the same CPU model differ as well; EPYC 9V74 VMs fell into two groups around 73 and 95 ms. The runner therefore measures every VM instead of looking up its CPU model. Revalidate the reference with new calibration-only dispatches when Chromium, Playwright, the benchmark or the fastest runner type changes.

With the calibration, five constrained dispatches at revision a30d62b4 confirmed 9 failures on an EPYC 7763 runner (applied rate 2.59), 4 on a Xeon Platinum 8370C (2.61), 9 on an EPYC 9V74 (3.31) and 6 and 9 on two EPYC 9V45 runners (3.95 and 3.94); before, an EPYC 7763 runner confirmed 20 at revision 4308a83e. The remaining failures also occur on the fastest runner, so they are application budget overruns rather than runner effects: `/tables/public/table_0000`, `/view-editor/public/v_table_0000`, `/matviews/public/mv_table_0000` and table scrolling on every runner (p95 33–50 ms against 17.5 ms), `/er-diagram` (worst step 117–150 ms against 100 ms) and `/sequences` on all but the 8370C, and on some runners the sidebar toggle on the table view, the palette, SQL typing, `/settings` and `/release-notes`. Two Chromium dispatches at the same revision (EPYC 7763 at 2.79, EPYC 9V74 at 3.27) passed every throttled query, palette, onboarding and segmented-control scenario; both confirmed only the monitor log (176–208 ms against 120 ms) and the unthrottled workspace table scrolling (p95 21.2–22.5 ms against 21 ms).

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
| Seasonal spider quip | 1,000,000 rows × 2,000 columns; reads at most 100 rows × 24 columns and 120 column names | 0.12 / 0.20 ms | 0.5 ms median, 1 ms p95 |
| Seasonal spider visit (no throttling) | 5,000 × 120 table on 28 October; 23 spider DOM nodes, all removed after the visit; one 2.2 s timer, zero database reads during the visit and no further timer that day; closing the tab clears the pending timer and sends a running spider away within 2 s; out of season or disabled schedules no timer and renders no seasonal DOM | Chromium 59.9 FPS, WebKit 60.1 FPS; p95 16.9 / 17.0 ms | > 55 FPS, p95 < 28 ms, < 40 nodes |

The spider visit's worst frame is not gated: WebKit measured 123–158 ms across four visits, while the same idle table already showed 189 ms before the spider appeared; Chromium measured 28.5–45 ms.

The 19-occasion seasonal calendar was checked separately on macOS 27.0.1, arm64, Apple M3, 16 GiB RAM, Bun 1.3.10 and Chromium 153.0.8010.12. These are unthrottled Vite development-browser measurements with a mocked Tauri transport, not packaged desktop or constrained CPU/heap results. No new WebKit, Windows, Linux, native WebView or live database-family coverage is established by this run.

| Seasonal calendar scenario | Measured workload and retained resources | Result | Unchanged limits |
| --- | --- | --- | --- |
| Calendar and guest quips | 300 batches of all 19 guests on 1,000,000 rows × 2,000 columns plus 12 calendar dates; only the existing Halloween quip reads row values, bounded to 100 rows × 24 columns and 120 names; other guests read the row count only | Median 0.115 ms / p95 0.378 ms per batch | Median < 0.5 ms, p95 < 1 ms |
| Christmas visit | 5,000 rows × 120 columns; 24 visitor DOM nodes, removed after the visit; no repeat on another table that day, zero additional database requests | 59.9 FPS, frame p95 17.5 ms | > 55 FPS, frame p95 < 28 ms, < 40 visitor nodes |

The existing Halloween scenario passed at 60.0 FPS / frame p95 17.2 ms in this run. Separate Easter and Halloween cancellation cases clear a pending 2.2 s visit timer without claiming the day and remove an already visible visitor within two seconds after closing its table. Off-season and disabled cases schedule no visit timer; turning accents off removes the visitor. Local `list_providers` calls resolve the application's static driver registry and are excluded from database-read counts. DOM and sampling limits establish bounded retention; renderer heap was not measured. Use `L8DB_PERF_APP=1 L8DB_SEASONAL_DEV_URL=http://localhost:1422 bun test tests/perf-seasonal-browser.test.ts` against a running dev server for this scoped mode; without that URL the test continues to use `dist` for CI.

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

### Confirmed open budgets (2026-10-13)

Run `38373910606` on `f49cbad8` confirmed these failures with two reruns each (median of three attempts). Values are the three attempts in CI. In the follow-up run `38376093480` on `f714db40`, the three Chromium rows passed the median of three and Windows core was green. That run again confirmed 22 constrained failures (the route switches below plus `/tables`, `/query` and `/` sidebar toggles, table open, palette, SQL typing, chart click, SQL tool menu, SQL/table menus, proxy user menu and wide results) and the same 13 WebKit failures (the six grid FPS scenarios, wide result, workspace scroll, row heights, navigator, live monitor and the two history tests).

| Suite | Scenario | Measured | Budget | Findings |
| --- | --- | --- | --- | --- |
| Chromium | History sheet cold open, 5,000 entries | 195-288 ms | 120 ms | Profile at 4x CPU: panel render 50 ms (virtualizer measurements for 5,000 rows 27 ms), Toaster 18 ms, search focus 44 ms forced layout, closing menu presence 25 ms. Explicit `dir` on `<html>` and non-modal menus showed no measurable effect. Next step: prepare the sheet while the tools menu is open. |
| Chromium | Query navigator cold open, 3,700 objects | 123-161 ms | 120 ms | Mounting registers a resizable panel with a forced layout and relays out Monaco. Keeping the panel registered and only collapsing it showed no measurable effect. |
| Chromium | Workspace table scroll, 5,000 x 120 | p95 21.9-22.3 ms | < 21 ms | Not analysed yet. |
| Constrained | Route switches `/`, `/tables`, `/query`, `/er-diagram`, `/monitor`, `/sequences`, `/view-editor`, `/matviews`, `/dashboard`, `/settings`, `/release-notes` | worst frame 117-367 ms | 100 ms | Local breakdown of the longest task: rendering-bound views (`/tables`, `/matviews`, `/dashboard`, `/settings`, `/release-notes`, `/view-editor`) spend 110-144 ms in style recalculation for only 300-1,200 elements; selector matching is below 100 ms even with selector statistics enabled. JavaScript-bound views (`/query`, `/er-diagram`, `/monitor`, `/compare`, `/query-builder`, `/create-table`) spend 160-300 ms mounting. Fixes need view-specific work such as rendering only the visible part first. |
| Constrained | Menus, palette, chart click, SQL typing, table open, wide results, sidebar on `/tables` | various | 48-100 ms | Several of these timed out before because earlier tests left the sidebar collapsed or a modal open; they now fail on timing only. |
| WebKit (macOS) | Grid FPS (table/result 13/50/121 columns), wide result, workspace scroll, row heights | 52-59 fps | > 59 fps | macOS runners only; not reproducible on Linux WebKit. Frame metrics are report-only in WebKit since 2026-10-30, see below. |
| WebKit (macOS) | History focus and Tab order | - | - | macOS WebKit does not move Tab focus to buttons and handles programmatic focus differently; Linux WebKit passes. |

### WebKit frame metrics (2026-10-30)

FPS, frame p95, worst-frame and frame-count limits stay hard in Chromium and are report-only in WebKit. The scenarios call `expectFrame` from `tests/fixtures/perf-webkit-profile.ts`: in Chromium it is `expect`, in WebKit it only logs a missed limit as `WebKit frame budget missed (informational)` together with the assertion's location. A WebKit frame value that is not a positive number still fails, so a broken frame sampler cannot pass. The grid, application and seasonal scenario JSON files record the measured frames with `frameBudgets: "informational"` in WebKit and `"enforced"` in Chromium. Latency, DOM size, memory, request counts and correctness remain hard in both engines.

Run `41025250339` on `4308a83e` (macOS 15 runner, WebKit) confirmed 13 failures after two reruns. Frame metrics only, now report-only: the eight grid scenarios (41–58.5 fps against > 59, frame p95 21–28 ms against < 21 ms) and the workspace table scroll (44.7 and 56.1 fps, p95 27 ms); the wide SQL result (49.1 fps) and infinite scrolling (54.5 fps) failed once and passed both reruns. Still hard: live monitor selection (median 363/301/305 ms against 250 ms), schema navigator opens (150/125/124 ms against 120 ms), the two history focus tests (Tab focus and the timeout waiting for the focused "Neuer Tab" button) and, in one of three attempts, grid coverage after a wheel step in the semantic 13-column table (rows were not yet rendered under the header 32 ms plus one frame after the wheel; the two reruns passed this check and three local WebKit runs passed it as well).

The live monitor selection was slow because every re-render of the monitor view rewrote the chart's `<style>` element: React 19 sets `dangerouslySetInnerHTML` again for each new props object, and WebKit then recalculated the style of the whole document (5,205 nodes). A WebKit timeline of nine selections showed one 73 ms style recalculation and 17 ms of layout per click; Chromium handled the identical stylesheet without that cost. Since `86228fe5`, `ChartStyle` renders the CSS as a text child that React only updates when the text changes. On a MacBook Air (Apple M3, 8 cores, 16 GiB RAM, macOS 27.0.1, Bun 1.3.10, Playwright WebKit 26.6 and Chromium 153.0.8010.12, no throttling) the WebKit selection median/p95 fell from 122–135/212 ms to 64–66/138–147 ms and the in-page time from click to the next frame from 82 to 19 ms; Chromium stayed at 64–71 ms median. The scenario now also fails when a selection writes, inserts or removes a `<style>` element; the previous code wrote one per selection.

Together with the history and navigator changes on `development` (`7bcf3c50` reaches the history buttons with the WebKit all-controls Tab key), WebKit run `41037457368` on `0f76ada9` passed all 41 tests without reruns: live monitor selection median/p95 117/205 ms without style writes, navigator cold open 87 ms and warm median/p95 83/108 ms. It logged 55 informational frame misses; the grid scenarios measured 34.3–60.0 fps with frame p95 18–56 ms. Chromium run `41037460458` on the same revision measured the live monitor at 83/190 ms and still fails only the workspace table scroll, with frame p95 21.4 ms against < 21 ms in all three attempts.

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


## SQL result quality of life

Implemented result retention after a failed manual query or script, raw/UTC/local timestamp display, optional background completion notifications, sampled content widths and named local result snapshots.

### Limits and behavior

- Failed execution retains the existing result object, without copying rows or querying again. The error and the previous successful SQL/time remain visible. Copy/export continue to use raw values and active masks.
- Time conversion applies only to timestamp strings with an explicit offset. Values without a time zone and date-only values stay unchanged. UTC/local displays support seconds or milliseconds; the original value is retained for editing, copy and export.
- Content sizing examines at most 200 evenly distributed loaded rows and 8,000 cells in total. Each measurement is capped at 256 characters and each column at 600 px. Large object values use a short placeholder. Sizing runs only on request.
- Notifications default to off. They are checked once when execution finishes, only after 10 seconds and when the window is in the background. The backend checks window focus again. Cancelled runs are silent. Messages contain only generic status and duration. No polling, timers or extra database requests are introduced.
- Snapshot writes use serialized IndexedDB transactions. Global limits: 10 snapshots, 500,000 serialized characters each, 2,000,000 total; each result must be complete and contain at most 999 rows and 200 columns. Nested values have depth/node bounds. Exhaustion reports an error and never evicts a saved result. Active masks are applied before saving. Snapshots are device-local and survive restarts; connection/database identity gates comparisons. Open dialogs refresh across windows.

### Measured platform and workload

2026-11-01: macOS (Darwin arm64), Apple M3, 16 GiB RAM, Bun 1.3.10. Native CPU; no CPU/heap simulation. Other work was running concurrently in the shared checkout. An initial diagnostic run used the installed Bun 1.4.3; the feature suite was then run with the required Bun 1.3.10. The measurements below use 1.3.10.

`bun test tests/query-qol.test.ts tests/perf-query-qol.test.ts`

Browser fixture: `L8DB_PERF_BROWSER=1 bun test tests/query-qol-browser.test.ts`. Both suites are registered in `scripts/test-performance.ts`; the browser fixture honors `L8DB_PERF_ENGINE` (only Chromium was run locally).

| Scenario | Workload | Median | p95 | Regression budget |
| --- | --- | ---: | ---: | --- |
| Existing header-only sizing baseline | 80 columns | 0.012 ms | 0.041 ms | Reference |
| New content sizing | 100,000 rows × 80 columns; ≤8,000 cell reads | 6.11 ms | 12.31 ms | p95 <50 ms |
| Local timestamp display | 10,000 timestamp values | 12.88 ms | 23.33 ms | p95 <80 ms |
| Snapshot encoding | 999 rows × 20 columns | 2.39 ms | 13.31 ms | p95 <100 ms |

Twelve concurrent snapshot writes retained four snapshots within the aggregate quota and rejected the rest. Storage/read/delete workload took 94.33 ms (budget <2,000 ms); retained heap delta after explicit GC was 756,798 bytes (budget <32 MiB, includes test fixtures). IndexedDB here uses fake-indexeddb; real browser persistence is covered separately. One thousand cancelled completion callbacks performed zero preference/focus checks, sent zero notifications and scheduled zero timers. The pure display/snapshot scenarios made zero database requests.

Header-only sizing remains available; content sizing intentionally does more bounded work. This is a new capability, not a claim that content sizing is faster than header sizing.

### Coverage

Scoped functional tests cover offsets/DST, precision, raw-value preservation, width bounds, snapshot masks/limits/atomic concurrent writes, restart reads, deletion, opt-in/background/threshold notification gates and cancellation. The browser fixture exercises the real query execution hook with mocked Tauri transport, virtualized result rendering, retaining data across repeated errors, timestamp conversion, content sizing, snapshot save/compare/reload/delete and 1440/390 px screenshots.

Native OS notification delivery and permission UX have not been exercised on macOS, Windows or Linux. No live database family was exercised for these display-only changes. Browser transport tests verify database request counts; they do not establish native Tauri webview or real database performance.

Browser measurement (Chromium, same machine and Bun version): 999 loaded rows kept 45 mounted table rows. Five consecutive failed queries retained the successful data, with 94.30 ms median / 456.00 ms p95 from the click handler through completion and the next animation frame (budget p95 <1,000 ms). An earlier measurement included Playwright actionability waits (440.11/570.33 ms median/p95); a repeat under concurrent load reached 1,266.05 ms. The final test measures inside the browser after the actual click, preserving the 1,000 ms budget and excluding automation wait time. Seven explicit query executions produced seven database execution requests; all timestamp, sizing, snapshot and reload actions introduced zero additional execution requests. Screenshots at 1440 and 390 px had no horizontal document overflow. No browser runtime errors were captured.

The shared-checkout TypeScript check is blocked by the parallel organization-policy change in `src/lib/organization-state.ts:35`. `cargo check` is blocked by the parallel `invoke_handler` wrapper in `src-tauri/src/lib.rs` (`E0282` at `generate_handler!`). These unrelated changes were preserved.

The initial default-feature Rust module test was stopped during the unrelated DuckDB native rebuild. The scoped fallback is `cargo test --no-default-features query_notification --lib`; optional DuckDB/ODBC behavior is outside this change.

The no-default-features Cargo test could not start because another process held the shared build-directory lock; the waiting process was stopped. The notification message/threshold unit test was run directly with `rustc --test` from the unchanged helper and test sections of `src-tauri/src/query_notification.rs`: 1 passed. This verifies that pure helper only, not Tauri command integration or OS delivery.


## RSA and configuration merge security fixes (2026-11-01)

Measured on macOS 27.0.1 arm64, Apple M3 (8 cores), 16 GiB RAM, Rust 1.99.0,
Bun 1.3.10. OpenSSL 4.0.3 is statically built from openssl-src 400.0.2.
These are native results on this machine. No Windows/Linux desktop execution,
CPU/heap simulation or coverage of every database family is claimed for this change.

The initial OpenSSL adaptation repeated complete key validation for each SSH
signature: 2048-bit median/p95 27.44/27.84 ms, 4096-bit 173.21/181.52 ms. It failed
the unchanged 100 ms median budget. The final implementation validates once using
an initializing OnceLock. Exactly one native key (or a failed validation state) is
retained per SSH keypair, with no global cache or history. Clones share the native
OpenSSL allocation; dropping the owning keypairs releases it. Concurrent first use
is initialized once; an eight-thread functional case verifies signatures independently.

| Final workload (21 signatures each) | Median | p95 | Limits |
| --- | --- | --- | --- |
| RSA 2048 JWT | 0.44 ms | 0.44 ms | median <100 ms, p95 <250 ms |
| RSA 2048 SSH | 0.47 ms | 0.47 ms | median <100 ms, p95 <250 ms |
| RSA 4096 JWT | 2.81 ms | 2.82 ms | median <100 ms, p95 <250 ms |
| RSA 4096 SSH | 2.95 ms | 2.96 ms | median <100 ms, p95 <250 ms |
| Deepmerge, 5,000 nested components, 21 merges | 10.22 ms | 15.57 ms | median <100 ms, p95 <250 ms |

Cold SSH imports took 28.18 ms (2048 bit) and 177.40 ms (4096 bit), each below
1,000 ms. Five additional private-key loads stay below 3 seconds per key size.
JWTs remain below 1,024 bytes; raw signatures are exactly modulus_bits/8 bytes.
Merge output is 507,781 bytes (budget <1 MB), with 5,000 output entries. Inputs
remain unchanged after an idle interval. These synchronous operations create no
requests, timers, polling or background tasks; cancellation has no pending work to
clean up. SSH integration separately checks tunnel teardown, closed local ports,
wrong passphrases and absence of retained tunnel entries.

The first cold-import run exceeded its 1,000 ms budget while native checks and
other CPU work ran concurrently. No budget was raised. Native performance tests
now run separately from parallel unit tests in the performance workflow; the
results above are from that isolated run. They are not a constrained-CPU result.

Reproduce with `cargo test --locked --lib rsa_security_perf -- --ignored --test-threads=1 --nocapture`
in src-tauri and `bun test tests/secure-deepmerge.test.ts tests/dependency-cli.test.ts`
at the root. The Rust suite rejects an outdated native OpenSSL release, verifies
RSA signatures independently with ring, and covers malformed keys and encrypted
PKCS#8 exports. Deepmerge tests exercise the actual Shadcn/registry resolution,
null-prototype objects, source/target poisoning, nested arrays and option compatibility.

## Table helper menus

Measured on 4 November 2026 on macOS (Darwin 27.0.0), arm64, Apple M3 (8 cores), 16 GiB RAM, Bun 1.3.10, Playwright Chromium. Tests use real UI components and mocked Tauri transport; no live database, native Tauri webview, Windows, Linux, WebKit or CPU/heap simulation was exercised.

Run the scoped interaction and performance scenario:

```sh
L8DB_WORKBENCH_BROWSER=1 bun test tests/table-helper-menus-browser.test.ts
```

The fixture simulates the next release through its package manifest response to exercise the existing `table.rows.watch` and `query.results.timestamps` registrations and NEW badges without changing the repository version.

The scenario covers menu discovery, time zone and precision persistence, observing a row through its context menu, changed values, accepting a baseline, deletion, empty state, Escape, and 1440/760/390 px layouts. The watch panel stays open during interactions with the underlying table. Only one observation can expand at a time; closing the panel unmounts its contents. Opening and closing do not repeat the comparison over loaded rows, add polling, or issue database requests.

| Workload | Measurement | Limit |
| --- | --- | --- |
| Open 200 observations over 5,000 loaded rows, 5 cycles | Median 576.46 ms; p95 578.09 ms | p95 < 1,000 ms |
| Watch panel DOM | 2,230 descendants | < 4,000 |
| Table DOM | 41 mounted rows | < 90 |
| Closed panel after settling | 0 panel nodes | 0 |
| Additional database requests during settings, comparison and panel cycles | 0 | 0 |

No background work is introduced. Closing uses Escape, and after 400 ms idle the panel is unmounted with unchanged transport call counts. Existing workbench unit tests cover subscription disposal and idle behavior. Resource evidence for this UI is bounded DOM, not a measured native-process memory limit.

The related SQL result browser scenario (`L8DB_PERF_BROWSER=1 bun test tests/query-qol-browser.test.ts`) passed with 999 loaded rows, 45 mounted rows, no browser errors and exactly the seven explicitly executed SQL requests. Retained-result latency was median 35.4 ms / p95 36.2 ms.

The unchanged core watch scenario (`tests/perf-workbench-qol.test.ts`) exceeded its existing 250 ms p95 comparison budget at 302.30 ms for 200 observations over 100,000 loaded rows during concurrent browser/typecheck work. It failed before reaching its retained-heap assertion. No budget or comparison implementation was changed and that scenario was not rerun. The other 25 scoped unit/core tests passed. These results do not establish native or all-provider performance.

The broader workbench browser scenario stopped on an existing Monaco undo expectation before reaching the table controls (`tests/workbench-qol-browser.test.ts:102`). The scoped table helper scenario above passed independently; the editor undo path was not changed or repaired.

The screenshot fixture now mounts the production `TableToolbarActions` instead of rebuilding a reduced two-item menu. The regression asserts exactly one action trigger and the presence of “Neue Zeile”, “Beobachtete Zeilen” and “Zeitdarstellung” in that same menu; opening and discarding the row draft is covered. A repeat on the same machine with the full toolbar measured median 589.54 ms / p95 594.04 ms, 2,230 panel descendants, 33 mounted table rows, zero closed-panel nodes and zero additional transport/database requests (22 assertions passed). Provider discovery uses the actual fallback registry in the transport fixture. TypeScript checking explicitly included the fixture. Screenshots now include the original row-add, paste, test-data, masking and export actions alongside the new entries.

## Startup path (2026-11-10)

The goal was the shortest possible time until the first paint and until the complete application is visible, with slow Windows PCs as the main target.

### What changed

- `index.html` paints a boot shell from inline CSS and a small inline theme script. The script reads the `l8db.boot` cache (resolved theme and five colours, written by `src/lib/boot-paint.ts` and mirrored to the native `localStorage`), so the shell has the right colours before the application bundle runs. Its hash is listed in `script-src`; `scripts/production-check.mjs` fails when the script changes without the hash. The stylesheets stay in `<head>` in their original order: moving them behind the shell painted a few milliseconds earlier but would have changed the cascade order of lazily loaded styles.
- React used to replace the splash with an empty root until the router had loaded. `router.load()` now runs before the first render, so the shell stays until the complete application commits.
- The static imports of `src/bootstrap.tsx` are bundled into three chunks (`startup-react`, `startup-vendor`, `startup`) that `index.html` preloads while IndexedDB opens. The three shell routes are not code-split any more. Three chunks instead of one let the browser parse them on separate threads; an automatic `maxSize` split broke the execution order and was discarded.
- The five background initializers are one deferred `background` chunk that loads when the page is idle after the first frames.
- The acorn parser left the start package (`packages/ui-plugin-api/src/execution-guard.ts`).
- Windows no longer rebuilds the jump list during setup, and the dock/jump list update from the frontend is debounced by one second, so it leaves the start path and collapses bursts of store changes into one call.

### Measurements

Same test (`tests/startup-perf-browser.test.ts`, `L8DB_PERF_CPU_RATE=1`, median of 5) on the production build of `28146dd9` and of this change. MacBook Air, Apple M3, 8 cores, 16 GiB, macOS 27.0.1, Bun 1.4.3, Playwright Chromium headless, no CPU throttling, mocked Tauri transport, 3,000 tables.

| Metric | Before | After |
|---|---|---|
| First contentful paint | 92 ms | 20 ms |
| Root without content | 127 ms | 0 ms |
| Application visible | 185 ms | 137 ms |
| Usable (table list rendered) | 304 ms | 218 ms |
| JavaScript until usable | 2.51 MB in 226 chunks | 2.30 MB in 8 chunks |
| JS/CSS files until usable | 228 | 10 |
| `invoke()` calls until usable | 41 | 33 |
| React commits until usable | 16 | 13 |

The start package that `tests/perf-bundle.test.ts` checks is now everything the first render needs: 2.21 MB in 5 files, budget 2.25 MB and at most 6 files. The same set was 2.28 MB in about 218 files before. The earlier 1.8 MB budget covered the entry and both shell layouts without the home view and was already exceeded at 2.02 MB.

Real application, `tauri build --debug --no-bundle` on the same MacBook, empty isolated profile, `L8DB_STARTUP_PROBE=1`, five warm starts: `native` 228–254 ms (of which window and WebView 158–184 ms and the setup hook 1–3 ms), shell 10–12 ms after navigation start, application 174–185 ms after navigation start, 410–439 ms in total. The first start of a freshly built binary took 5.4 s because macOS scans the new executable.

### Limits and missing coverage

- New budgets in `tests/startup-perf-browser.test.ts`: first paint at most 150 ms, no empty root, at most 16 JS/CSS files until usable. The existing 2.2 MB script budget stays exceeded at 2.30 MB (2.51 MB before); it was not changed.
- `tests/boot-paint.test.ts` covers the cache and the boot script, including 10,000 theme mutations collapsing into one style read and no work when idle. `tests/window-integration.test.ts` covers the debounced dock update with 1,000 store changes.
- Not measured: Windows and WebView2, a release build and real slow hardware. The browser numbers use a mocked transport without IPC latency.

### Linux run with CPU throttling (2026-11-10)

Debian 13 VM (x86_64, QEMU virtual CPU, 8 cores, 15 GB RAM, shared host with load 1.0–1.8), Bun 1.3.10, Playwright Chromium 156 headless, `tests/startup-perf-browser.test.ts` with 3,000 tables, median of 5, the same test file against the build before (`b9e66c32`) and after (`4c25d637`). Nominal throttle 4×; the calibration applied only 1.75× (before) and 1.96× (after), so the throttled columns are not a 4× result and the new build ran under the stronger throttle.

| Metric | Before, throttled | After, throttled | Before, unthrottled | After, unthrottled |
|---|---|---|---|---|
| First contentful paint | 476 ms | 140 ms | 304 ms | 104 ms |
| Root without content | 768 ms | 0 ms | 439 ms | 0 ms |
| Application visible | 1046 ms | 954 ms | 663 ms | 479 ms |
| Usable | 1665 ms | 1624 ms | 1227 ms | 761 ms |
| Long tasks until usable | 864 ms | 1089 ms | 431 ms | 459 ms |
| Worst frame until usable | 417 ms | 567 ms | 200 ms | 250 ms |
| JS/CSS files until usable | 228 | 12 | 228 | 10 |
| `invoke()` calls until usable | 42 | 34 | 42 | 34 |

With a slow CPU the first paint and the file count improve clearly, the time until usable barely moves and the long tasks grow, because the same code now runs in fewer, larger tasks. A CPU profile of the new build (MacBook Air M3, 214 ms until usable) attributes about 17 ms to module evaluation, 32 ms to React DOM, about 40 ms to style and layout and about 40 ms to lazy function compilation; no single function dominates. Further gains on slow CPUs need less rendering work at start or a warm process, not more bundling.
- A cold start cannot reach 50 ms: creating the window and the WebView alone took about 170 ms on this MacBook and takes longer on slow Windows PCs. Only a process that is already running can show the application that quickly.

### Measuring on another machine

Start the application with `L8DB_STARTUP_PROBE=1`. It logs one line such as `startup: native 228 ms (window 158 ms, setup 1 ms), shell 12 ms, app 182 ms, total 410 ms` and exits after the first complete render. `native` is the time from `run()` to the start of the navigation, `shell` and `app` count from there. Without the variable the same line is written to the log file on every start.

## Terminal mode `l8db tui` (2026-11-11)

The interactive terminal mode (`src-tauri/src/cli/tui/`, iocraft) keeps every loaded cell as a pre-shortened string and cuts the visible window out of it per frame. Scrolling reads only that in-memory grid; a database request starts only from Enter, `d`, `m`, Ctrl+R or opening a connection, and while one runs the state machine accepts nothing except Ctrl+C. There are no timers, so an idle TUI neither renders nor queries.

### Limits

- Table rows load in pages of 100 up to 1,000 rows per table view; SQL results are capped at 1,000 rows by the same limit as `query`. Cells are shortened to 80 characters before they are stored.
- Budgets in `cargo test --lib cli::tui` (debug build): scrolling window p95 below 4 ms, object-list filter p95 below 20 ms, rendered iocraft frame mean below 50 ms.

### Measured workload

MacBook Air, Apple M3 (8 cores), 16 GiB RAM, macOS 27.0.1, rustc 1.99.0, unoptimized test profile, no throttling, one run:

| Scenario | Result |
|---|---|
| 5,000 scroll steps over a 1,000 x 60 grid, 200 x 50 viewport | median 0.35 ms, p95 0.43 ms per window, at most 11,900 bytes of text per frame, 0 database requests |
| Control: 2,000 scroll steps over 100,000 x 20 rows | median 0.31 ms, p95 0.36 ms, so frame cost does not grow with row count |
| Loading a table to the cap with `m` | exactly 10 requests for 1,000 rows, then `m` is ignored |
| Object list with 20,000 tables, typing a 12-character filter and 200 page steps | median 3.4 ms, p95 4.0 ms, 0 database requests |
| iocraft frames through the mock terminal, 300 keys over a 1,000 x 60 result at 200 x 50 | 250 frames, mean 15.8 ms per frame |
| Busy state | every key except Ctrl+C returns no effect; Ctrl+C returns exactly one cancel |

The end-to-end run (`L8DB_CLI_E2E=1 bun test tests/cli-e2e.test.ts`, SQLite, pseudo-terminal) cancels an endless recursive query with Ctrl+C and returns to the editor; the table still holds its 250 rows afterwards.

### Missing coverage

Windows and Linux were type-checked only (`cargo check --target x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu` on a scratch crate with the TUI modules); the TUI has not run on either. Drivers other than SQLite were not exercised through the TUI. Retained memory was bounded by construction and by the row cap, not measured as process RSS. No throttled-CPU run.


## Lokale Importvorprüfung: NULL-Verletzungen

`tests/perf-csv-validation.test.ts` gehört zur Core-Suite und kann einzeln laufen.
Der synchrone Prüfschritt scannt die geladenen Datensätze, zählt alle Verletzungen
zugeordneter NOT-NULL-Spalten und hält höchstens zehn Fehlerdetails. Er startet
keine Datei-/Datenbankzugriffe, Timer oder Hintergrundläufe; ein Abbruch eines
laufenden Hintergrundjobs ist daher nicht anwendbar. Der Idle-Test prüft, dass
nach Rückkehr keine weiteren Zellzugriffe stattfinden. Dies ist keine vollständige
Datei-, Typ-, Unique-, FK- oder Triggerprüfung und kein erfolgreicher Probeimport.

Messung vom 16.11.2026: macOS/Darwin 27.0.0, arm64, Apple M3, 16 GiB RAM,
Bun 1.3.10. 10.000 Datensätze × 32 NOT-NULL-Spalten, 320.000 Verletzungen,
15 gemessene Durchläufe nach zwei Warmläufen: Median 1,41 ms, p95 1,48 ms.
Nach zehn zusätzlichen Durchläufen und GC blieben 29.131 Bytes zusätzliche
JS-Heapgröße; dies ist eine lokale Heapmessung, kein RSS- oder Native-Heap-Beweis.
Der Bericht enthält zehn Details und bleibt im Szenario unter 2.000 Zeichen.
Budgets: Median < 50 ms, p95 < 100 ms, zusätzlicher gehaltener JS-Heap < 4 MiB.
Keine Browser-/DOM-Leistungsmessung, Windows-/Linux-Messung oder Live-Datenbank
in diesem Paket; keine CPU-/Heap-Simulation als Plattformabdeckung ausgegeben.


## Vollständiger schreibfreier CSV-Dateicheck

Der Import bietet „CSV-Datei prüfen“ über `check_csv_file` an. Der Befehl nimmt
keine Verbindung oder SQL entgegen und verwendet `import_source::open_csv_records`
mit dem vorhandenen Streamingparser. Die gewählte Datei muss im Tauri-FS-Scope
liegen. Parsergrenzen bleiben 1 GiB pro Datei und 1 MiB pro Datensatz; der
bestehende Encoding-Test liest höchstens 2 MiB zusätzlich. Es werden keine
Dateiinhalte oder sämtliche Befunde gesammelt: ein Datensatz zur Zeit, exakte
Anzahl vollständig gelesener Datensätze und höchstens zehn Details ohne Zellwerte.
Strukturfehler und explizite NULL-Verletzungen werden gezählt, ein nicht mehr
sicher fortsetzbarer Parserfehler beendet den Lauf als unvollständig.

Ein globaler Slot erlaubt höchstens einen aktiven Dateiscan. Ein wartender Check
kann abbrechen, bevor er die Datei öffnet; aktive Checks kontrollieren den Token
je Zeichen. Betriebssystemseitig blockierende Datei-/Metadatenzugriffe sind nicht
hart unterbrechbar. Fortschritt entsteht ereignisgesteuert statt durch Polling:
Anfang/Ende und höchstens etwa zehn Zwischenmeldungen je Sekunde. Nach Rückkehr
bleibt kein Scan oder Hintergrundtimer aktiv.

Der Bericht ist ein Dateistand, kein Probeimport: keine Datentyp-/Wertebereichs-,
Unique-, FK- oder Triggergarantie. Quell-/Zuordnungs-/Optionswechsel verwerfen den
Bericht sofort und brechen den alten Lauf ab; späte Antworten werden ignoriert.
Ein bestätigter Abbruch kann seine tatsächlich gelesene Teilanzahl anzeigen,
niemals eine vollständige Freigabe. Größen-/Zeitstempeländerungen während des
Scans und vor späterem Import werden abgeglichen. Das ist kein Hashnachweis oder
atomarer Dateilock; beliebige Änderungen mit erhaltenem Zeitstempel bzw. zwischen
letzter Prüfung und Import sind dadurch nicht ausgeschlossen.

Gezielte native Regressionen: `CARGO_BUILD_JOBS=2 cargo test --lib db::csv_ -- --nocapture --test-threads=1`
im Verzeichnis `src-tauri`. Das deckt den gemeinsamen Parser, späte Struktur-/
NULL-Befunde, EOF-/Header-/CR-/CRLF-/Multiline-Fälle, Dateiveränderung, Abbruch vor
und während des Scans, Warteschlange, Fortschrittsbegrenzung und 1-MiB-Grenze ab.
Der Performancefall liest 100.000 Datensätze mit zwei Pflichtspalten und 200.000
Befunden: zwei Warmläufe, fünf Messläufe, Medianbudget < 1.500 ms und p95 < 2.500 ms
im Debug-Testprofil; Bericht < 3.000 Bytes und zehn Details im Szenario. Das sind
lokale Tempdateien, keine Live-Datenbankzugriffe oder allgemeine Netzwerk-FS-Messung.

Frontend: `tests/csv-file-check*.test.ts(x)` prüft den echten Bridgevertrag,
Abbruch beim Backend-Start, Listenerbereinigung, verspätete Antworten, erneute
Prüfung sowie den eingeschränkten UI-Erfolgstext. Der zusätzliche Core-Performancefall
in `tests/perf-csv-validation.test.ts` misst 1.000 Report-Invalidierungen mit 9
Messläufen: Median 0,74 ms, p95 1,64 ms, zusätzlicher gehaltener JS-Heap nach GC
8.579 Bytes; Budgets < 50/< 100 ms und < 4 MiB. Gemessen am 16.11.2026 auf
macOS/Darwin 27.0.0, arm64, Apple M3, 16 GiB, Bun 1.3.10. Der eingespritzte
Controllerlauf startet keine nativen Requests. Keine Browser-/DOM-Leistungs- oder
Windows-/Linux-Abdeckung, kein RSS-/Native-Heap-Nachweis; die native Speichergrenze
wird hier durch begrenzte Datensatz- und Berichthaltung geprüft, nicht als
plattformweite Speicherprofilierung ausgegeben.

Native Abschlussmessung dieses Pakets am 16.11.2026 auf demselben Mac im Debug-
Testprofil: 100.000 Datensätze, zwei Spalten, 200.000 Befunde, Median 67,29 ms,
p95 68,99 ms, Bericht 996 Bytes. Abbruch im großen Datensatz: 1,81 ms in der
lokalen Tempdatei, Budget < 1 s. Alle 15 gezielten nativen CSV-Tests bestanden;
Warteschlangenabbruch öffnet keine Datei und der Scan gibt seinen einen Slot
wieder frei. Keine Aussage über harte Abbruchlatenz auf blockierenden externen
Dateisystemen oder andere Plattformen.


## SQL-Server-Indexrollen (A37)

Der vorhandene `list_indexes`-Lesebefehl kann optionale `roles` liefern. Die
Trait-Standardmethode übernimmt andere Adapter ohne Rollenänderung; deren JSON
enthält weiterhin nur die bisherigen Indexfelder. Der native SQL-Server-Pfad
liest Schlüsselrang/-richtung, INCLUDE und Filter in einer Katalogabfrage mit
LEFT JOINs. `ROW_NUMBER` überträgt den Filtertext nur einmal pro Index; die
Zusammenführung erhält ihn auch bei umgeordneten Zeilen. Treiberzeilen werden
vor der eigentlichen Gruppierung freigegeben; kein Nachladen je Index oder
neuer Hintergrund-/Pollingprozess kommt hinzu.

Gewöhnliche Clustered-/Nonclustered-Indizes werden als Schlüssel, INCLUDE und
sonstige/nicht eingeordnete Indexspalten dargestellt. Rang 0 ist nicht allgemein
INCLUDE; beispielsweise werden Columnstore-Spalten nicht zu INCLUDE-Schlüsseln
umgedeutet. Filterzustände sind `none`, `known` mit Prädikat, `unavailable`
(Filter vorhanden, Text nicht verfügbar) und `unknown`. Fehlender Text erzeugt
keine unfiltrierte CREATE-Definition. Nur bekannte Zeilenindexrollen erlauben
die ausdrücklich rekonstruierte Schlüssel-/INCLUDE-/Filterdefinition; das ist
kein vollständiger SQL-Server-DDL-Roundtrip mit allen Optionen/Dateigruppen.
Bei unbekannten Rollen oder Sondertypen bleibt die Definition unverfügbar.
Der bestehende Tabellen-DDL-Weg bricht bei einer solchen benötigten Definition
explizit ab, statt ein unvollständiges Statement als vollständigen Export zu zeigen.

Katalogfixtures in `src-tauri/src/db/mssql/indexes.fixture.json` sind synthetische
Beispiele der tatsächlich abgefragten Katalogfelder, keine Produktionsdaten oder
hier aufgenommenen Live-Serverergebnisse. Tests prüfen Reihenfolge/Richtung,
INCLUDE, Prädikat, ausgeblendeten Filtertext, NULL-Metadaten, Sondertypen,
Identifierquoting, umgeordnete Zeilen und kompatibles Legacy-JSON. Gezielter Lauf:
`CARGO_BUILD_JOBS=2 cargo test --lib db::mssql::indexes::tests -- --nocapture --test-threads=1`
in `src-tauri`. Der Mapping-Performancefall verwendet 1.000 Indizes und 12.000
Katalogzeilen, zwei Warmläufe und sieben Messungen. Budgets: Median < 250 ms,
p95 < 500 ms, serialisierter Ausgabevertrag < 2 MiB im Szenario. Das ist reine
Zuordnung mit null Datenbankzugriffen; keine gemessene Live-Kataloglatenz.

`tests/index-metadata-transport.test.ts` prüft eine bestehende Bridge-Anfrage
samt optionalen Rollen ohne Folgeanfrage oder neue Idle-Aktivität. Die bestehende
Indexansicht zeigt zunächst höchstens acht INCLUDE- und acht sonstige Spalten
je Index und bietet gezieltes Erweitern; bekannte Schlüssel bleiben in ihrer
Reihenfolge. `tests/perf-index-roles.test.tsx` rendert 500 Indizes mit je 128
INCLUDE-Spalten als SSR-Markup: 5.000 anfängliche Spalten-Chips, 1.449.011 Bytes
Markup, Median 31,70 ms, p95 123,42 ms bei neun Messungen nach zwei Warmläufen.
Nach fünf weiteren Läufen und GC blieben 728 Bytes zusätzlicher JS-Heap.
Budgets: Median < 250 ms, p95 < 500 ms, zusätzlicher JS-Heap < 8 MiB,
Markup < 4 MiB. Gemessen am 16.11.2026 auf macOS/Darwin 27.0.0, arm64,
Apple M3, 16 GiB, Bun 1.3.10. Dies ist SSR-Ausgabe, keine Browser-Layoutmessung
oder manuelle visuelle Abnahme. Keine Live-SQL-Server-/Windows-/Linux-Messung,
keine Simulation als Plattformabdeckung und kein Native-/RSS-Profil behauptet.

Native Abschlussmessung der Katalogzuordnung auf demselben Mac im Debug-Testprofil
(Rust 1.99.0): Median 19,80 ms, p95 21,58 ms, serialisierter Vertrag 723.001 Bytes
für 1.000 Indizes/12.000 Zeilen. Diese Zahlen enthalten weder Netzwerk-/Serverzeit
noch das Tiberius-Decoding; es ist kein Vergleichsbenchmark des alten, semantisch
unvollständigen Vertrags. 20 gezielte native MSSQL-Tests bestanden, zehn bestehende
Live-DB-Tests blieben ignoriert. Nach dem Filtertext-/Zusammenführungsfix wurden
nur die sechs betroffenen Katalogtests erneut geprüft und bestanden. Keine neuen
Indizes angelegt oder produktiven Datenbanken verändert.


## Messumfang der Abfragezeit (A38)

Der vorhandene Ergebnisstatus kennzeichnet direkte PostgreSQL-/MySQL-Ergebnisse
als „inkl. Ergebnisübernahme“. Die UI speichert den geprüften Messumfang am
zurückgegebenen Ergebnis; der aufrufende Anbietertyp wird vor dem Request
festgehalten. Ein späterer Verbindungswechsel etikettiert alte Ergebnisse nicht um.
Es gibt keine neue Uhr, Serverzeit-Schätzung, Phasenaufteilung oder Zusatzabfrage.

Belegt sind `postgres.rs::run_simple_query`/`SimpleResult::finish`,
`postgres.rs::run_params_query` und `mysql.rs::read_query`: Der native Timer beginnt
vor Abfrage beziehungsweise Vorbereitung und endet nach Empfang und Aufbau der
Ergebnisdaten. Das umfasst Serverarbeit und Ergebnistransport, ist keine reine
Serverzeit. Verbindungsaufbau, nachfolgende Nacharbeiten (etwa MySQL-Warnungen),
IPC-Übergabe und Darstellung gehören nicht dazu. Read-only-Wrapper und
PG-Serverausgabe behalten denselben inneren Timer. Die Anzeige erklärt den Umfang
per Tastatur- und Hover-Tooltip im bestehenden Status, ohne Zahlen zu verändern.

Andere Anbieter, alte unmarkierte Ergebnisse und Skript-/verwaltete
Transaktionsergebnisse bleiben ausdrücklich „Messumfang unbekannt“; dort fehlt
im UI-Vertrag ein geprüfter Messumfang beziehungsweise der tatsächliche Treiber.
Lokale emulierte Sitzungsview-Schritte werden als „Nicht gemessen“ markiert:
Ihr bestehender Zeitwert 0 ist ein Platzhalter, kein gemessener DB-Zeitwert.
Eine eventuell nötige Metadatenprobe wird dadurch nicht als zugriffsfrei erklärt.
Der native `QueryResult`-Bridge-Vertrag bleibt unverändert; `timingScope` ist
optionale Ergebnis-Metainformation der UI.

`tests/perf-query-result-timing.test.ts` prüft 10.000 Statusaktualisierungen auf
einem Ergebnis mit 100.000 Zeilen, zwei Warmläufe und neun Messungen. Jede
Zell-/Zeilenmaterialisierung löst im Fixture einen Fehler aus. Gemessen am
16.11.2026: Median 1,350 ms, p95 1,642 ms; nach fünf weiteren Läufen und GC
1.224 Bytes zusätzlicher JS-Heap. Budgets: Median < 50 ms, p95 < 100 ms,
zusätzlicher JS-Heap < 4 MiB. Null Zellzugriffe und null DB-Requests; nach Idle
keine nachträgliche Zeilenarbeit. Kein neuer Hintergrundlauf, daher kein eigener
Abbruchmechanismus nötig. Das ist ein additiver Statusbenchmark, kein Vergleich
der nativen Abfragedauer vor/nach einer Optimierung.

Plattform: macOS/Darwin 27.0.0, arm64, Apple M3, 16 GiB RAM, Bun 1.3.10.
Semantik-/Transportmocktests und SSR prüfen die Kennzeichnung, erhaltene Zahlen,
Unbekannt-/Null-Platzhalter und tastaturzugängliches Status-Markup. Keine
Live-Datenbanken, Browser-/Native-App-Abnahme, Windows/Linux, CPU-Simulation
oder native/RSS-Messung; keine Rust-/Adapteränderungen in diesem Paket.


## SQL-Server-Zeilenversionen (A40)

SQL-Server-Spaltenmetadaten verwenden für den nativen Typnamen `timestamp`
das gleichbedeutende `rowversion`. Das gilt nur im MSSQL-Adapter: einfache
`ColumnInfo` und detaillierte `DetailedColumnInfo` erhalten denselben kanonischen
Namen. Es gibt keine neue Bridge-Eigenschaft, Zusatzabfrage oder Wertkonvertierung.
Der native DDL-Weg behält `timestamp`, wenn der Server diesen Namen liefert;
Rohwerte bleiben in der bestehenden binären Hexdarstellung. Andere Adapter und
echte Zeittypen wie `datetime2`, PostgreSQL-/MySQL-`timestamp` bleiben erhalten.

Gemeinsame Verbraucher erkennen `rowversion` als opaken Text-/Binärwert:
kein Datumstyp aus Zeilensamples, kein Enum-Vermutungswert, kein fiktiver
Längenparameter `rowversion(8)`. Bestehende Spaltenfilter, Datumsoperatoren,
Datumsbeispiele und Dashboard-Typprüfung bekommen damit den korrekten Typ.
Die Korrektur setzt frisch geladene Metadaten voraus; historische, separat
gespeicherte Typtexte und alte Cache-Snapshots werden nicht migriert.

`tests/fixtures/mssql-rowversion-types.json` ist ein synthetisches gemeinsames
Katalogfixture für native und TS-Tests: Alias-Großschreibung, beide Namen,
echte Zeittypen sowie unveränderte Dezimal-/Binärtypen. Native Tests prüfen
zusätzlich den unveränderten DDL-Ausdruck, die direkte Spaltenprojektion und
bestehendes binäres Wertdecoding. Verbraucherregressionen prüfen Gridtyp,
Spaltenfilter/-anzahl, Datumsoperatorauswahl, AI-Beispiele, Dashboardtyp und
bestehende Zeitformatierung. Es werden keine Datenbanken verbunden oder SQL,
DDL, Schreibvorgänge oder Migrationen ausgeführt; dies ist eine Fehlerkorrektur
bestehender Anzeigen, kein neuer Benutzerweg.

Das vorhandene `tests/perf-column-filters.test.ts` ist um 10.000 gemischte
SQL-Server-Spalten erweitert (5.000 Zeilenversionen, 5.000 echte Zeittypen).
Zwei Warmläufe, 15 Messungen: Median 5,515 ms, p95 6,188 ms; nach fünf weiteren
Läufen und GC 0 gemessene zusätzliche JS-Heap-Bytes. Budgets: Median < 40 ms,
p95 < 80 ms, zusätzlicher JS-Heap < 4 MiB. Der bestehende allgemeine 10.000-
Spaltenfall bestand ebenfalls (Median 4,275 ms, p95 4,531 ms, 40 Messungen).
Keine Budgetanhebung; keine Optimierung oder Vorher-/Nachher-Beschleunigung
behauptet. Beide zählen/klassifizieren lokal mit null DB-Requests.

Gemessen am 16.11.2026 auf macOS/Darwin 27.0.0, arm64, Apple M3, 16 GiB RAM,
Bun 1.3.10. Die Zuordnung ist synchron und hat keinen neuen Hintergrundlauf,
Polling oder Abbruchpfad. Keine Native-App-/Browser-Abnahme, Live-SQL-Server-
oder PostgreSQL-/MySQL-Laufzeitprüfung, Windows/Linux, CPU-Simulation oder
native/RSS-Allokationsmessung. Vorhandene Opus-UI-Handoffs bleiben offen.

Der native Alias-Mapper prüft separat 10.000 Katalogtypen, zwei Warmläufe und
sieben Messungen im Rust-Debug-Testprofil: Median 1,257 ms, p95 1,264 ms;
10.000 Ausgabe-Strings mit zusammen 92.500 Typzeichenbytes. Budgets: Median
< 50 ms, p95 < 100 ms, exakt begrenzte Ergebnismenge. Das ist keine Messung
von Server-/Netzwerkzeit oder native/RSS-Speichernutzung. Beide neuen gezielten
Rust-Tests bestanden; andere MSSQL-/A37- oder Live-Tests wurden nicht wiederholt.


## Teilbarer Schemaänderungsbericht (A03)

Schema-Vergleich → Bericht → Kopieren / Speichern erzeugt einen Markdown-Bericht
aus dem vorhandenen `CompareResult` und dem bereits berechneten `SyncScript`.
Es gibt keinen weiteren Katalogzugriff, Vergleichslauf, DDL- oder SQL-Aufruf.
Der Bericht enthält alle behaltenen Vergleichseinträge unabhängig von Suchfilter
und Skriptauswahl; Angaben zu kritischen Anweisungen beziehen sich ausdrücklich
nur auf den ausgewählten, nicht ausgeführten SQL-Plan. Quelle ist der gewünschte
Stand, Ziel der anzugleichende Stand. Mögliche Umbenennungen sind keine zwingenden
Löschungen. Datenverlustrisiken werden nicht als vollständig geprüft dargestellt.

Vergleiche speichern zusätzlich angefragte Typen, bekannte Snapshot-Tabellenlisten
und die Zeitpunkte aus den tatsächlich gelesenen Snapshot-Dateien. Die effektiven
Typen, ignorierte Merkmale, Ausschlussmuster und ausgelassene Unterschiede werden
im Bericht genannt. Keine Vollständigkeit des Serverkatalogs, aktuelle Live-
Übereinstimmung oder ausgeführte Migration wird behauptet. Ältere Ergebnisse ohne
belegte Typauswahl erfordern einen erneuten Vergleich; unbekannte Berichtsfelder
werden nicht in einen positiven Vollständigkeitsbefund umgedeutet.

Fehlende, laufende, fehlgeschlagene und hinsichtlich Seiten/Optionen/Typen veraltete
Vergleiche sperren die Aktion. Nach dem nativen Speicherdialog werden Vergleich
und Skriptauswahl erneut gegen den aktuellen Store geprüft; bei Änderungen wird
nichts geschrieben. Abbrechen schreibt nichts. IO-Fehler melden keinen Erfolg.
Berichtserzeugung findet nur auf ausdrückliche Aktion statt; kein Idle-Worker,
Polling oder zusätzlicher Abbruchprozess. Eine gestartete synchrone Generierung
ist durch 20.000 Einträge, 4.194.304 Zeichen und 16.384 Zeichen je Textfeld begrenzt;
Überschreiten schlägt ausdrücklich fehl und erzeugt keinen still gekürzten Bericht.

Namen, Merkmale und Hinweise stehen als JSON-quotierte, einzeilige Markdown-
Codespannen mit dynamisch längeren Backtick-Begrenzern im Bericht. Steuerzeichen
und Richtungswechselzeichen können keine neuen Berichtzeilen oder Überschriften
vortäuschen. DDL, SQL-Anweisungen, Verbindungs-URLs und vollständige Dateipfade
werden nicht hinzugefügt. Die vorhandene visuelle Sprache und Copy-/Save-Bridges
bleiben erhalten; die neue Aktion trägt `schema-compare.report` am echten Button.

`tests/perf-schema-report.test.ts`: 5.000 abweichende Spalteneinträge, zwei
Warmläufe und neun Messungen; Median 31,240 ms, p95 31,630 ms. Ausgabe 1.510.863
Zeichen; nach fünf weiteren Generierungen und GC 2.982.783 zusätzliche JS-Heap-
Bytes einschließlich eines behaltenen Berichts. Budgets: Median < 100 ms,
p95 < 200 ms, zusätzlicher JS-Heap < 8 MiB, Ausgabe unter dem Berichtslimit.
Null zusätzliche DB-Requests und null Schreibaktionen nach Abbruch/Idle.
Dies ist ein neuer Berichtsbenchmark, kein Vorher-/Nachher-Optimierungsnachweis.

Gemessen am 16.11.2026 auf macOS/Darwin 27.0.0, arm64, Apple M3, 16 GiB RAM,
Bun 1.3.10. 38 gezielte Vertrags-/Aktions-/SSR-/Snapshot-/Tab-/Options-Tests sowie
Typecheck und scoped Biome bestanden. Keine Rust-/Adapteränderung; deshalb kein
Cargo-Neulauf. Keine Live-Datenbanken, reale Datei-/Clipboard-Dialogprüfung,
Browser-/Native-App-Abnahme, Windows/Linux, CPU-Simulation oder native/RSS-
Messung. Der vorhandene CSV-Opus-Handoff bleibt unverändert offen.


## Keyword-Mappinggrenzen im Filter (A41)

Der bestehende `list_table_columns_detailed`-Bridge-Aufruf kann ein optionales
`exact_filter` je Spalte liefern. Ein flacher `ColumnMetadata`-Wrapper erhält die
bisherigen `DetailedColumnInfo`-Felder und lässt das Zusatzfeld für andere Adapter
weg; interne DDL-/Import-/Spaltenaufrufe behalten ihren bisherigen Typ. Der
Elasticsearch-Adapter verwendet denselben vorhandenen Mapping-GET und denselben
Keyword-Wähler. Keine zusätzliche Settings-, Versions-, Dokument- oder
Kataloganfrage und keine Änderung des erzeugten Filter-DSL kommen hinzu.

Metadaten nennen das vom Client gewählte Zielfeld (auch ein anders benanntes
Keyword-Multifeld wie `.raw`), Keyword vs. Match-Phrase und `ignore_above` als
konfiguriert / nicht deklariert / unbekannt. Auch 0 bleibt eine explizite Zahl;
fehlende, negative oder nicht ganzzahlige Werte werden nicht als unbegrenzt
behandelt. Bei mehreren Index-Mappings bleibt die gemeinsame Grenze unbekannt.
Es gibt keinen Nachweis, dass jeder Alias-Index dieselben Felder besitzt.
Indexmodus und Wirkung sind ausdrücklich `unverified`: Der Mapping-Abruf belegt
keine Settings oder Versions-/Indexmodusregeln. Insbesondere wird eine deklarierte
Zahl nicht pauschal auf alle normalen oder spaltenorientierten Modi übertragen.

Der bestehende Filtereditor zeigt bei =, <>, IN und NOT IN einen kompakten Hinweis
mit tastaturzugänglichem Tooltip. Alte/fehlende Metadaten bleiben unbekannt;
Freitext-Kommentare werden nicht zu einem strukturierten Grenznachweis geparst.
Lokale Zeilenregel-Editoren erhalten diesen Serverhinweis nicht. Zahlen/andere
nicht unterstützte Feldtypen und andere Provider erhalten keinen Keyword-Hinweis.
Keine Längenvalidierung oder Blockade verändert den Filterwert: Eine Zahl aus
`ignore_above` allein beweist weder die wirksame Grenze noch vollständige Abdeckung;
ein Nichttreffer beweist keinen fehlenden Dokumentinhalt. Nicht-Keyword-Textfilter
bleiben als analysierte Match-Phrase gekennzeichnet. Feature-ID am tatsächlichen
Hinweis: `table.filter.keyword-limit`.

Die gemeinsamen synthetischen Mappingfelder in
`tests/fixtures/elastic-keyword-mapping.json` decken direkte Keywords, `.keyword`,
`.raw`, fehlende/ungültige Limits, Text ohne Keyword sowie nested/wildcard/numerische
Felder ab. Native Regressionen erhalten vorhandene Exakt-/Phrase-Filter; der lokale
HTTP-Mock prüft genau einen Mapping-GET ohne Folgeabfrage oder Idle-Polling.
Frontendtests prüfen strukturierten Bridge-Transport, alte Daten, sichere Namen,
Provider-/Operatorgates und die Filterformular-Anbindung. Die Formular-SSR
verwendet gestubbte Select-/Werteingabe-Primitives; der reale Hinweisknopf und
Tooltip werden separat gerendert. Das ist keine native oder Browser-UI-Abnahme.

Native Abschlussmessung im Rust-Debug-Testprofil: 2.000 Text-/Keyword-Mappings
plus `_id`, zwei Warmläufe und sieben Messungen; Median 35,415 ms,
p95 94,156 ms, serialisierte Ausgabe 741.732 Bytes. Budgets: Median < 250 ms,
p95 < 500 ms, Ausgabe < 2 MiB im Szenario. Enthalten sind bestehende Mapping-
Zuordnung, neue Hinweise und JSON-Serialisierung; keine Netzwerk-/Serverlatenz
oder native/RSS-Allokationsmessung. 17 gezielte Elasticsearch-Adaptertests
bestanden, einschließlich alter Filter-/Paging-/OpenSearch-Regressionen. Der
Legacy-Wrapper wird zusätzlich auf exakt gleiche JSON-Felder geprüft.

Frontend: 10.000 Hinweisaktualisierungen, zwei Warmläufe und neun Messungen;
Median 0,888 ms, p95 0,902 ms, nach fünf weiteren Läufen und GC 0 gemessene
zusätzliche JS-Heap-Bytes. Budgets: Median < 50 ms, p95 < 100 ms, zusätzlicher
JS-Heap < 4 MiB. Gemessen während der native Debug-Testbuild noch lief; keine
CPU-Simulation. Keine neuen DB-Requests, Worker oder Idle-Aktivität; es gibt
keinen neuen eigenständigen Abbruchpfad. Der bestehende HTTP-Lebenszyklus
bleibt erhalten, der lokale Mock sieht genau eine Mapping-Anfrage.

Plattform: macOS/Darwin 27.0.0, arm64, Apple M3, 16 GiB, Bun 1.3.10.
Dies sind neue Semantik-/Übertragungsbenchmarks, kein Vorher-/Nachher-Nachweis
einer Optimierung. 49 gezielte Frontendtests, Typecheck, Cargo-Check und scoped
Biome bestanden. Bestehende Tiberius-, Backup-Test- und macOS-Linkerwarnungen
wurden nicht geändert. Keine produktiven Reads/Writes, echte Elastic-/OpenSearch-
Versions-/Indexmodusprüfung, Browser-/Native-App-Abnahme, Windows/Linux,
CPU-/Heap-Simulation oder native/RSS-Messung. Bestehende Opus-Handoffs bleiben offen.

Der zusätzliche Legacy-Wrapper-Test bestand ebenfalls (1/1): Ohne optionalen
Hinweis entspricht das serialisierte JSON exakt der bisherigen Spaltenform.
Insgesamt 18 native Prüfungen bestanden. Nicht verglichene Indexsettings,
externe Mappingänderungen nach dem Lesen und tatsächliche Feldabdeckung bleiben
unbekannt; es gibt keinen automatischen Aktualisierungs- oder Grenzprüfungsnachweis.


## Optionale Herkunft gespeicherter Abfragen

Query speichern → Herkunft merken ist standardmäßig ausgeschaltet. Der bestehende
Speicherfluss kann zusätzlich eine lokale Verbindungs-ID, den Namen beim Speichern
und die ausgewählte Datenbank merken. Eine unbekannte Datenbank bleibt unbekannt;
es wird keine URL ausgewertet oder Verbindung getestet. Der Herkunftsschlüssel
umfasst alle drei Angaben: Bei einem anderen Kontext gilt eine frühere Checkbox-
Auswahl nicht für das neue Ziel. Öffnen des Dialogs setzt die Auswahl zurück.
Ein bewusstes Überschreiben ersetzt SQL und Herkunft; ohne Auswahl wird die Query
allgemein. Reines Umbenennen in der Bibliothek erhält die bisherige Herkunft.
Der bestehende direkte Verlauf-Speicherweg bleibt allgemein.

`origin` ist ein optionaler rückwärtskompatibler Zusatz im vorhandenen SavedQuery-
Store und v1-Query-Export. Speicherung, Rehydrierung, Import und Export projizieren
nur bekannte Felder. Herkunftstexte sind auf 256 Zeichen pro Feld begrenzt;
Verbindungs-URLs, erkennbare Credential-Zuweisungen und Steuer-/Richtungszeichen
werden nicht übernommen. IDs werden nicht als sichtbare Verbindungsnamen benutzt.
SQL und Queryname bleiben unverändert. Der Exportdialog nennt den optionalen
Herkunftszusatz; ältere Clients können ihn beim erneuten Export verlieren,
Name und SQL bleiben mit dem bisherigen Format nutzbar.

Bibliotheks- und Sidebarlisten zeigen Herkunft neben dem Namen, ohne neue
Bibliothek oder zusätzliche Zeile im virtualisierten Query-Verlauf. Suche kann
Namen/Datenbank der Herkunft berücksichtigen; ohne Suchtext bleiben alle Queries
sichtbar, unabhängig von der aktiven Verbindung. Lokale Namen werden über eine
pro Verbindungsänderung erstellte ID-Map aufgelöst. Abweichende Namen heißen
„gespeichert als …“, ohne einen tatsächlichen Umbenennungsvorgang zu behaupten.
Fehlende IDs werden nicht über Namensgleichheit neu zugeordnet; fehlende oder
unzulässige Namen bleiben erkennbar. Herkunft ist kein Ziel- oder Kompatibilitäts-
nachweis. Laden übergibt weiterhin nur SQL beziehungsweise ID/Titel/SQL an den
bestehenden Tabweg, ohne Verbindungswechsel oder Auto-Ausführung.

28 gezielte Tests prüfen den echten Named-Save-/Store-/Persistenz-/Tabfluss,
Altformat/Leerzustand, Übernahme/Ablehnung nach Kontextwechsel, Umbenennen,
Entfernen, sichere Projektion, v1-Transfer und Dublettenkopien. SSR prüft den
ungewählten/fehlenden Kontext und die realen Bibliothekszeilen. Typecheck und
scoped Biome bestanden. Kein Rust-/Bridge-Code geändert; kein Cargo-Neulauf,
produktiver DB-Zugriff, Browser-/Native-App-Walkthrough oder Opus-Versuch.
Die bestehende Fenster-Synchronisierung bleibt am gleichen Store aktiv; ihre
Rehydrierungsgrenze ist synthetisch geprüft, keine reale Mehrfensterabnahme.

`tests/perf-saved-query-origin.test.ts`: 5.000 Queries (hälftig allgemein und mit
Herkunft), 250 Verbindungen; je zwei Warmläufe und neun Messungen. Auflösung/Suche:
Median 1,810 ms, p95 2,178 ms. Ein echter Named-Save inklusive Store-Serialisierung:
Median 1,214 ms, p95 2,176 ms. Bereinigter Export: Median 1,986 ms, p95 2,013 ms.
Ausgabe 915.978 Zeichen; zusätzlicher JS-Heap nach fünf weiteren Läufen und GC
2.065.804 Bytes einschließlich eines Exports und rehydrierter Daten. Budgets je
Szenario: Median < 100 ms, p95 < 200 ms; zusätzlicher Heap < 8 MiB, Ausgabe < 4 MiB.
Null DB-Requests, unveränderter Speicherinhalt nach Idle; keine neuen Worker oder
Abbruchpfade. Diese Zahlen beschreiben den neuen Kontextpfad, keine behauptete
Beschleunigung des bisherigen Stores. Gemessen am 16.11.2026 auf macOS/Darwin
27.0.0, arm64, Apple M3, 16 GiB, Bun 1.3.10. Keine Windows-/Linux-/Browserlayout-,
CPU-Simulations- oder native/RSS-Messung. CSV-Opus-Handoff unverändert offen.


## PostgreSQL array editing (A01)

The existing cell dialog uses its text mode for SQL array types (`…[]`), preserving
numeric lexemes rather than routing edits through the JSON tree's JavaScript numbers.
The native direct and transactional update paths share one catalog-driven encoder:
JSON notation supports scalar and enum elements, rectangular arrays up to six
dimensions, SQL NULL elements, empty text and empty arrays. Existing lower bounds
are reused per dimension; new dimensions start at one, and empty arrays are canonical.
JSON/composite/element-domain arrays require explicit PostgreSQL array text. Raw
array text remains available, including explicit bounds; ordinary JSON columns
keep their editor and write contract. No extra metadata roundtrip or background
work is introduced; the existing metadata read is extended. JSON conversion is
synchronous and bounded to 8 MiB and 100,000 elements, not cancellable mid-codec.
The surrounding database operation retains its existing cancellation behavior.

Measured once on macOS 27.0.0 arm64, Apple M3, 16 GiB RAM, rustc 1.99.0 debug
and Bun 1.3.10; two warmups and 21 samples:

| Scoped scenario | Measured result | Gate |
|---|---|---|
| Native exact-row decode + update assignment, 12,000 escaped Unicode text elements, 240,891 input bytes | median 23.018 ms / p95 23.226 ms | median <100 ms / p95 <200 ms |
| Native result capacities | SQL 277,092 bytes; decoded vector/string capacity 1,360,538 bytes | SQL <8× input +1 KiB; decoded <2 MiB |
| Existing text-editor preparation, 12,000 text elements and 312,001-character exact numeric array | median 0.412 ms / p95 0.647 ms; 0 additional retained heap bytes after 30 repeats and GC | median <100 ms / p95 <200 ms; retained <4 MiB |

Run `cargo test --lib db::postgres::arrays::` for native correctness/performance
and `bun test tests/perf-postgres-array-editor.test.ts` for the core-registered
editor budget. Shared fixtures also exercise actual exact-row decoding, cell
drafts and both mocked update transports, including quotes, backslashes, NULL,
empty values, numeric scale and unsupported shapes. Codec/editor helpers issue
no database requests and start no timers/workers; metadata plus the existing
UPDATE remains the runtime request pattern, established statically here.
The original measurements did not include a live server. The scoped follow-up
below adds actual PostgreSQL catalog/type-cast/array-bound execution. Visual/native
editor acceptance, Windows/Linux, constrained CPU and native peak-RSS remain
unmeasured. Capacity checks bound retained results, not every temporary allocation.

`bash scripts/test-postgres-arrays-local.sh` provisions an owned ephemeral
PostgreSQL 17.11 server and executes the real native direct/transactional paths.
On macOS 27.0.1 arm64, Apple M3, 16 GiB, Rust debug profile: 512 escaped Unicode
text elements, two warmups and nine update-plus-grid-read samples measured
median **4.471 ms**, p95 **6.707 ms** (limits <250 / <500ms). This includes the
existing native metadata/write/readback work, not just codec SQL generation.
No browser/IPC paint or whole-app RSS is measured. The input row ID is fetched
before the timed interval; calls are serial with a single explicit writer.

The same run verifies 26 valid direct/transactional value/bounds cases, rollback
visibility, 16 rejections before any UPDATE and zero retained transaction IDs or
idle-in-transaction sessions. A nontransactional statement-trigger sequence
detects an attempted UPDATE even when no row mutation would survive. Total
network/catalog request counts are not instrumented; no claim of one complete
roundtrip per edit or a before/after optimization is made. Existing codec work/
capacity budgets are unchanged. Native editor visual acceptance and other
providers/platforms remain open; only the owned local cluster is stopped/deleted.


## Existing procedure results (A16)

The existing procedure dialog retains the `QueryResult` already returned by
`executeQuery` and passes that same object to `QueryResultTable`, with the existing
read-only cell inspector. No additional OUT bindings, cursor fetches or rowset
requests are added. Empty rowsets, no rowset/affected-row results, errors and the
backend truncation flag stay distinct. The result grid remains local to the dialog
without a persisted view key or result history.

One dialog instance accepts one pending call. A repeat clears the previous result
and gets a fresh result-view identity. Parameter, routine/signature, connection
or database changes and closing invalidate old responses. Closing does not
cancel or roll back the server call; reopening waits for the outstanding promise
before another explicit call is allowed in that mounted dialog. No automatic
retry or polling is introduced.

Scoped `tests/perf-procedure-run.test.ts` is registered in the core performance
suite. Measured on macOS 27.0.0 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10, with
1,000 rows ×100 columns (64-character payloads), two warmups and 21 samples:

| Scenario | Result | Budget |
|---|---|---|
| Local reference-based result lifecycle | median 0.002708 ms / p95 0.004667 ms | median <10 ms / p95 <25 ms |
| Abandoned-context invalidation | median 0.000375 ms / p95 0.000750 ms | p95 <10 ms |
| Retained heap after 50 result/clear cycles and GC | 23,735 bytes | <2 MiB |

The test starts 74 explicit simulated executions across its measured and retention
phases, rejects an overlapping call, and starts zero idle requests/notifications
during a 25 ms observation. Transport fixtures verify one existing SQL execution
per explicit action; unrelated existing initialization RPCs are not SQL requests.
These timings measure the local result lifecycle, not database duration or grid
paint. No new native code: live provider returns, real DOM/focus/virtual scrolling,
Windows/Linux, constrained CPU and native RSS remain unmeasured. The six SSR
contracts use actual dialog/result sections with mocked hook/grid dependencies;
they do not constitute a native-app visual acceptance.


## SQL literal-list import into existing IN filters (A11)

The existing list input offers an explicit SQL-list preview/confirm action.
Recognizable parenthesized SQL-list paste opens that preview without changing
filter values; ordinary delimiter paste and single-value operators retain their
existing behavior. Confirmation appends deduplicated string values to the current
JSON list and uses the unchanged provider/type-aware filter compiler. This is
value conversion, not execution or preservation of the source expression types.
No filter-submit/query action is dispatched by the importer.

Supported input is one parenthesized list of standard single-quoted text
(including doubled quotes and N-prefixed text), decimal number lexemes or boolean
literals. SQL NULL, empty/blank-only strings, expressions/comments outside text,
backslash escapes, unsupported literal forms and trailing SQL fail as a whole.
Existing storage cannot retain blank-only entries, and NULL-in-list semantics
are not represented as a string. Preview source is invalidated when current
values/operator change; cancel never changes the current filter.

New import limits: 131,072 UTF-16 code units of source, 1,000 source/combined
values and 524,288 encoded JSON code units. Existing non-import formats are not
recapped. The preview renders at most five values, each abbreviated after 120
code units, plus a remainder count; complete values stay in the encoded list.
All parsing is synchronous/bounded; a closed preview performs no parsing or
background work. No native API changes or new polling/cancellation job.

Scoped `tests/perf-sql-filter-list-import.test.tsx` is core-registered. Measured
once on macOS 27.0.0 arm64, Apple M3, 16 GiB RAM, Bun 1.3.10; two warmups,
21 parser/rejection samples and nine actual existing-input SSR samples:

| Scenario | Result | Budget |
|---|---|---|
| Parse/merge 1,000 literals, 86,891 source code units | median 0.940 ms / p95 1.080 ms | median <20 ms / p95 <40 ms |
| Existing input SSR after import, 1,000 chips | median 21.166 ms / p95 85.784 ms; 818,610 HTML bytes | median <100 ms / p95 <200 ms; HTML <2 MiB |
| Oversized input rejection | p95 0.000208 ms | <5 ms |
| Retained heap after ten prepare/render repeats and GC | 89,328 bytes | <8 MiB |

Functional checks use the actual input/preview callbacks and current compiler,
including PostgreSQL/MySQL/SQL Server/Oracle/MongoDB output contracts and an
in-memory SQLite selection fixture. Performance helpers start zero database
requests or background tasks. SSR/event-harness results do not establish real
DOM focus/popover/keyboard behavior, native-app paint or provider execution.
Live databases, Windows/Linux, constrained CPU/heap and native RSS were not tested.


## Captured server output after grid writes (A12)

`runTableTransaction` drains the existing transaction-output API once after the
row operation, including failed operations, before immediate commit/rollback.
Managed operations remain busy until this drain finishes; staged changes/errors
and finalization guards are unchanged. Retrieval/delivery failures produce a
neutral existing toast and cannot replace the write outcome. Unsupported
providers incur no output request. No polling or new driver capture is added.

The table-data entry opens the existing ServerOutputPanel for the captured
connection/database. Copy and clear affect only that database; the query panel
keeps its existing connection-wide behavior when no database is supplied. Output
can include other work in that connection/database, including rolled-back work:
it is neither current-table attribution nor a commit receipt. Native paths that
do not already buffer notices are not fixed by this frontend drain. Oracle's
existing transaction DBMS_OUTPUT retrieval is reused; commit-generated output
after finalization is not newly captured.

Scoped core-registered `tests/perf-table-server-output.test.ts`, macOS 27.0.0
arm64, Apple M3, 16 GiB RAM, Bun 1.3.10; two warmups and 11 samples:

| Workload | Result | Budget |
|---|---|---|
| One existing output drain of 2,000 messages against a 100,000-entry history | median 1.959 ms / p95 3.099 ms | median <50 ms / p95 <100 ms |
| Database selection over the retained history | median 0.471 ms / p95 0.620 ms | p95 <25 ms |
| Retained heap delta after GC | 0 bytes; history remains capped at 100,000 | <32 MiB additional heap |

The measured workload performs exactly 13 mocked output reads, one per explicit
operation, and zero idle requests over 25 ms. This measures the local delivery
and bounded existing store, not server/network latency or peak RSS. Failure,
rollback, staged/busy and late-scope regressions use the actual managed operation
API with synthetic transport; two UI SSR cases use mocked dialog/panel boundaries
and a current-store selector (SSR normally uses Zustand's initial snapshot).
No live provider/trigger, native capture, browser/focus/dialog or actual log
virtualization acceptance; no Windows/Linux or constrained CPU/heap run.

The subsequent A12 browser acceptance used macOS arm64, Apple M3, 16 GiB RAM,
Chrome and Bun 1.3.10. The 380 × 420 px dialog rendered 31 rows at the end of a
2,000-message history. Keyboard scrolling reached both ends with fewer than 100
mounted log rows and no IPC during the 100 ms idle interval. The existing
100,000-entry delivery fixture measured 3.085 ms median and 57.057 ms p95.
Scoped selection measured 1.867 ms median and 4.795 ms p95. The test passed with
476,762 bytes of retained heap, 13 synthetic output reads and zero idle reads.

The unchanged older benchmarks were rerun in isolation after initial budget
misses during concurrent checks. Retaining 100,000 of 120,000 messages passed at
32.631 ms p95. Streaming 2,000 ten-line batches with an output watcher remained
above its 150 ms gate at 196.689 ms p95. This test exercises the existing output
store without mounting the dialog. The acceptance patch leaves the store and
both budgets intact. Timing of native rendering, real provider capture and
system clipboard delivery remains outside the browser check.

## Exact numeric display (A15)

The existing display menu now offers opt-in digit grouping and minimum fraction
digits (0, 2 or 4). The default remains original. Known numeric table columns
format exact strings by copying digits, without Number conversion or rounding;
existing fraction digits and exponent notation remain intact. Missing query
type metadata leaves numeric-looking strings unchanged. Native finite JavaScript
numbers can be formatted, but precision already lost upstream cannot be recovered.
Raw copy, CSV export, sort, filter and edit contracts remain independent of display.

Formatting accepts at most 4,096 input characters and never expands exponents;
longer or unsupported values use the existing bounded raw preview. No numeric
cache, timer, background task or database request is introduced. Existing width
sampling/caps are reused and consider formatted text lazily. There is no
asynchronous formatting to cancel or retain after a view is abandoned.

Core-registered `tests/perf-number-display.test.ts`, macOS 27.0.1 arm64,
Apple M3, 16 GiB RAM, Bun 1.3.10; two warmups and 11 measured samples:

| Workload | Result | Budget |
|---|---|---|
| Format/check 20,000 exact long integer/decimal strings | median 12.180 ms / p95 12.727 ms | median <75 ms / p95 <150 ms |
| Format 200 maximum-size strings of 4,096 characters | median 3.506 ms / p95 3.767 ms | p95 <100 ms; output <8,200 characters |
| Reject a 1,000,000-character value into raw-preview fallback | p95 0.003209 ms | p95 <5 ms |
| Retained heap delta after five additional batches and GC | 0 bytes | <8 MiB |

These are formatter/validation timings, not browser frame or total grid-render
latency. Actual table/result cells and menu callbacks have separate SSR/event
regressions with a synthetic current-store selector; all four table styles,
raw copy/edit/inspect callbacks, persistence merge and width paths are covered.
The menu remains shared across views rather than a per-column format setting.
The original formatter package omitted browser and native acceptance.

The isolated A15 Chrome acceptance exercised the existing menus and both grids
in wide light and 365 px dark layouts, including local setting persistence.
Format changes sent zero IPC requests. The only recorded IPC on the compact
path was one synthetic clipboard write. The formatter recheck on the same
macOS/arm64/Bun configuration stayed within the original budgets: 20,000 exact
strings took median 12.156 and p95 12.585 ms, 200 maximum-size strings took p95
3.655 ms, fallback took p95 0.002875 ms and retained heap delta was 0 bytes.
Browser frame times, native WebView, live provider data, constrained CPU/heap,
Windows/Linux and native RSS remain outside this check.

## CSV check inline progress and cancellation integration

The existing runner forwards only matching job-ID events with nonnegative safe
integer counts. The controller retains one monotone count, initially unknown;
duplicate/regressing, aborted, invalidated and disposed-run events do not notify
the view. A single native cancellation promise is reused, including task-dialog
cancellation and registration races. There is no polling, percentage, inferred
total or additional file/database request. End results remain authoritative;
cancelled/error/changed/incomplete checks cannot clear the import blocker.

`tests/perf-csv-validation.test.ts` adds 100,000 progressing counts plus 100,000
duplicates, 10,000 post-cancel events and one post-disposal event. Two warmups and
11 samples on macOS27.0.1 / Darwin27.0.0 arm64, Apple M3, 16GiB, Bun1.3.10:
median **5.288ms**, p95 **8.964ms** (budgets <50 / <100ms). One counter retained;
heap delta after two additional batches and GC **0 bytes**, budget <4MiB.
There are exactly100,003 notifications per batch (start, distinct progress,
cancel request, terminal), one synthetic runner invocation, no post-cancel/idle
notifications, no polling and no database requests. This is controller/event
cost, not native parsing throughput, browser frame latency or process RSS.

Real controller/runner/bridge/task-store regressions additionally cover both
cancel controls, delayed readiness, restart, stale successes/errors/events and
scope/unmount invalidation; only the native transport is synthetic. Existing
import actions consume the shared unsuccessful-check blocker. No write import
or productive connection is exercised.

The registered browser runner supports a scoped existing scenario and an explicit
installed Chrome channel, without copying tests or downloading a browser:

```sh
L8DB_BROWSER_CHANNEL=chrome bun scripts/test-browser.ts csv-file-check
```

System Chrome157.0.8103.79 checks the actual hook/menu status components through
synthetic IPC, including keyboard cancel/restart, unknown/live row counts, late
events/errors after source/mapping/options/scope/unmount, all terminal states and
380px light layout. The shared T3 preview also checked inline counts and narrow
layout; hot refresh during fixture edits produced a duplicate-root diagnostic,
so its accumulated transport-call counts are not used as request-count proof.
The fresh registered browser tests disable HMR. Native Tauri file-dialog/IPC/event
acceptance remains open: the available03:58 debug binary uses compiled context;
the separate AI-workspace config is not a verified fresh isolated runtime. The
normal profile initializes connection secrets/services. Neither profile's private
data was opened or altered, and no app or database was started for this check.
WebKit, Windows/Linux, constrained CPU/heap and native RSS remain untested.

### Isolated CSV development entry

`tests/perf-csv-development.test.ts` measures 10,000 release-gate rejections plus
10,000 explicit development decisions per sample, two warmups and 11 samples.
On macOS 27.0.1 / Darwin 27.0.0 arm64, Apple M3, 16 GiB, Bun 1.3.10: median 2.458 ms,
p95 3.111 ms (limits <50 / <100ms), 22 bytes retained heap after five additional
batches and GC (limit <4MiB). The gate retains no state and starts no native/DB
requests, timers or background work. Production-entry compilation removes the
debug loader; the ordinary bootstrap remains. These are selector microbenchmarks,
not desktop boot, native parser throughput, constrained CPU/heap or RSS results.

Native functional acceptance now uses the real incognito debug WebView and
existing parser, with no regular connection/secret/service initialization or
registered SQL/import-write commands. It verified dialog grants, clean/findings/
parser-error/cancel/changed states and cleanup of two fresh session directories.
The larger owned fixture was 1,048,576 records / 254,803,976 bytes; native cancel
returned 4,318 records, while the changed-file run discarded its result. No native
latency/peak-memory comparison is claimed. See `docs/csv-check-development.md`
for the reproducible explicit entry and the separate desktop-tool limitations.

### A01 isolated editor development harness

The scoped gate regression in `tests/perf-array-editor-development.test.ts` measures30,000 decisions per sample (11 samples,2 warmups), including a1MB query rejected before parsing. Budgets: median<50ms, p95<100ms and retained JSC heap<4MiB; no requests, timers or background work. The browser scenario uses the existing cell dialog with512 text elements over9 measured edits after2 warmups: median<1000ms, p95<2000ms, DOM<1500 nodes, exactly1 handshake plus2 IPC calls per successful edit and zero extra calls during an idle interval. Its transport is synthetic, not a database latency result.

The real `--editor-test` fixture scenario uses512 elements,9 samples after2 warmups, serial provider writes and fixed readback; budgets median<250ms, p95<500ms and serialized snapshot<64KiB. Initial local measurement: median7.915ms/p958.236ms on macOS27/arm64 Apple M3,16GiB, PostgreSQL17.11, debug Rust with2 build jobs. Final browser measurement on installed system Chrome: median983.201ms/p95986.088ms,27 DOM nodes before the subsequent static reread-button exposure,23 calls for11 edits and no idle calls. The final gate scenario measured median2.739ms/p953.556ms and99 bytes retained JSC heap. Native keyboard/IPC correctness subsequently passed; native editor paint latency was not benchmarked. Total native network request counts/peak RSS, physical low-resource hardware, other platforms and native editor paint were not measured. Existing codec/provider budgets and supported array forms are unchanged.

### A16 isolated routine result

The local PostgreSQL 17.11 fixture returns a single OUT row with 57,351 UTF-8 bytes of text and a SQL NULL. With the debug build on macOS 27.0.1, Apple M3 arm64 and 16 GiB RAM, nine sequential calls after two warmups took 4.431 ms median and 4.815 ms p95. Limits are 150 ms median, 300 ms p95 and less than 64 KiB per serialized result. One overlapping request was rejected during the six-second call. The fixture uses no polling.

The existing 1,000-row by 100-column controller test retained 39,829 bytes on Bun 1.3.10. Result lifecycle timing was 0.007 ms median and 0.523 ms p95, with one maximum concurrent execution and no idle requests. The earlier controller run measured 0.003 ms median and 0.005 ms p95. These runs measure controller overhead on separate invocations. No new controller algorithm was introduced. The browser regression verifies one truncated cell preview and the full read-only value after opening the inspector. Native rendering latency and peak process memory were outside these measurements.

The A11 popover acceptance repeated the same workload on macOS 27.0.1 arm64 (Apple M3, 16 GiB, Bun 1.3.10). The parser measured 1.174 ms median and 2.799 ms p95 for 1,000 values. SSR measured 28.839 ms median and 47.592 ms p95, with 818,610 HTML bytes and no measured retained heap growth in the 10-cycle test. The size and timing budgets above still apply. The browser fixture additionally verifies the five bounded preview nodes and counts zero query IPC calls. Browser interactions and native paint latency are outside the SSR timing.

## Low-end devices: reduced motion, grid scrolling and tab switches (2026-11-19)

Reported on a weak Windows PC: tables and tab switches lag. `bun scripts/perf-profile-probe.ts` opens three table tabs (500 rows × 24 columns, 3,000 tables) in the production build with the mocked transport, then traces 18 tab switches and 120 wheel steps (400 px vertically, partly 300 px horizontally) with `devtools.timeline` plus a 200 µs CPU profile. `PROBE_REDUCED=1` emulates `prefers-reduced-motion: reduce`, `PROBE_DIST` selects another build, `PROBE_WAIT` the settle time per switch and `PROBE_INCLUSIVE=<n>` prints inclusive function times. Use an unminified build for readable names.

Findings and changes:

- The global reduced-motion rule set `transition-duration: 0.01ms` on every element. With the default `transition-property: all`, every style change on every element then started a transition: 120 wheel steps dispatched about 5,000 `transitionrun`/`start`/`end`/`cancel` events, which React's root listener received about 20,000 times, and each one cost extra style and paint frames. Windows reports reduced motion when its animation effects are off, which is common on weak PCs, so this mode was slower than full motion. The rule now sets `transition-duration: 0s` and `transition-delay: 0s`, so no transition starts; animations keep `0.01ms` so `animationend` still fires. `Collapse` already unmounts without `transitionend` in this mode.
- Rows moving under a resting pointer changed their hover background on every step, which repainted and re-layerized rows. `trackScrolling` (`src/lib/hooks/use-scrolling-flag.ts`) sets `data-scrolling` on the grid scroller with one attribute write per scroll burst and removes it 140 ms after the last event; the `grid-hover` and `row-hover` variants skip their style while it is set. Pointer events stay enabled, so clicks, selection and `elementFromPoint` are unchanged. The flag is not set while a pointer button is down.
- `hasNewFeatures` built 316 entry tuples and ran one regular expression per feature on every call, and tab strips, layouts and menus call it on every render. It now scans a cached list of the current release's IDs.
- `animateChange` uses the brief opacity feedback instead of the 420 ms travel when `navigator.hardwareConcurrency` is at most 4.

Measured on macOS 27.0, arm64, Apple M3 (8 cores), 16 GiB RAM, Bun 1.4.3, Playwright Chromium, no CPU throttling. Values are main-thread totals for the whole run.

| 120 wheel steps | Script | Style | Layout | Paint | Layerize | Sum incl. pre-paint and hit tests |
| --- | --- | --- | --- | --- | --- | --- |
| Full motion, before | 471 ms | 112 ms | 58 ms | 295 ms | 386 ms | 1,454 ms |
| Full motion, after | 455 ms | 111 ms | 59 ms | 188 ms | 207 ms | 1,140 ms |
| Reduced motion, before | 1,196 ms | 449 ms | 156 ms | 703 ms | 691 ms | 3,450 ms |
| Reduced motion, after | 496 ms | 155 ms | 58 ms | 183 ms | 205 ms | 1,219 ms |

18 tab switches under reduced motion went from 831 ms script / 280 ms style to 738 / 220 ms. The existing gates passed once: workspace table scroll 5,000 × 120 at 60.0 fps, frame p95 18.2 ms (previously confirmed red at 21.2–22.5 ms against < 21 ms), infinite scroll frame p95 18.3 ms, and all eight `tests/perf-browser.test.ts` grid scenarios. `tests/perf-low-end.test.ts` measured 20,000 badge lookups over 316 features at median 9.0 ms / p95 9.3 ms (before: 180.5 / 195.2 ms; gate 40 ms p95) and 10,000 scroll events in 1.9 ms with one attribute write, no flag while a button is pressed, and no listeners, timer or writes left after disposal. None of this starts database work.

Open: a tab switch still unmounts one view and mounts the next, about 34 ms of React work, 12 ms style and 13 ms paint/layerize per switch on this machine. Within that, the grid's `DragDropProvider` teardown takes about 2.7 ms and motion's layout projection about 1.7 ms. Sticky row-number cells are one compositor layer each (31 of 65 layers); without them Layerize dropped a further 40 % in an experiment. Keeping recent tabs mounted would remove most of the switch cost and is not implemented.

Not covered: no Windows machine, WebView2 build, weak GPU or CPU throttling was measured; the throttled suites do not run on this Mac. The mocked transport excludes database time. The core-count heuristic was verified only in `tests/change-animation.test.ts`; `tests/perf-workspace-motion.test.ts` pins eight cores and was not run.

## Tab groups: all pane tabs, saved tab bars and cross-connection opening (2026-11-24)

A tab group now stores every tab of every pane (`SplitGroup.paneTabs`, only written when a pane holds more than one tab), a tab bar can be saved as a group without a split (`saveTabs`), and a group shared from another connection opens in the active connection as a copy (`adoptGroup`). The last state of a closed query or tool tab that a group still references lives once per connection in `closedTabs` (query tabs inside a group are stored without their SQL); it is dropped again as soon as the tab is open, when no group references it after an overwrite, a deletion or a live split following the close, and on hydration. A fresh split reuses an existing group only when the tabs of every pane match, so a group with more tabs is never overwritten by splitting its two visible tabs again.

Limits: 50 groups per connection (unnamed `Ansicht N` views that are not active are evicted first, otherwise saving is refused), no timer in any group operation, no database request except the schema check when a copied group opens (see below), one store write per operation, no store notification for no-op calls. `closedTabs` holds at most one copy per closed query or tool tab that a group references; its size is bounded by the SQL the user typed, not by the number of groups.

Measured on macOS 27.2.1, arm64, Apple M3 (8 cores), 16 GiB RAM, Bun 1.4.3, mocked Tauri transport, no CPU throttling. Nine measured runs follow two warmups.

`tests/perf-tab-groups.test.ts` (scenario `tab-groups`): 600 open tabs (400 tables, 200 queries with 1,970 characters of SQL each), one split group following 400 tabs in four panes, one saved tab bar with 200 tabs, 48 more groups with 22 tabs each, 21 connections.

| Operation | Workload | Median / p95 | Gate (p95) |
| --- | --- | --- | --- |
| Follow a pane focus change | 100 changes, 400-tab group | 3.09 / 3.97 ms | 100 ms |
| Move a tab between panes | 100 moves | 3.24 / 3.41 ms | 100 ms |
| Overwrite a saved tab bar | 20 saves of 200 tabs | 1.44 / 1.96 ms | 20 ms |
| Open a group | 20 switches between a 400-tab and a 22-tab group | 2.61 / 3.00 ms | 40 ms |
| Close everything and reopen two groups | 600 closes, 600 reopened tabs | 2.55 / 2.96 ms | 40 ms |
| Close a tab | 50 closes plus one group reopen | 7.89 / 9.41 ms | 100 ms |
| Open a group from another connection | copy, open, delete and close 400 tabs | 1.49 / 2.12 ms | 20 ms |
| List shared groups | 100 listings over 20 connections × 50 groups | 1.53 / 3.47 ms | 50 ms |
| No-op calls | 300 calls, 0 store notifications | 0.05 / 0.07 ms | 10 ms |

Earlier runs of the same scenario stayed within 3.00–5.73 ms p95 for opening and 8.77–9.68 ms for closing. The persisted store measured 440,263 characters with an unopened copy of 133 queries and 851,954 with 200 more closed queries (gate: below 1,000,000 and at most one SQL copy per closed query). The only transport call was the one-time `list_providers`.

`tests/perf-split-groups.test.ts` (scenario `split-saved-views`, 1,000 tabs, 50 groups of four panes), before → after, measured from a clean export of the previous revision on the same machine:

| Operation | Before | After |
| --- | --- | --- |
| 100 focus changes | 3.43 / 3.66 ms | 2.23 / 2.82 ms |
| 20 group switches | 2.08 / 2.30 ms | 1.21 / 1.61 ms |
| 100 moves | 4.98 / 5.14 ms | 3.04 / 4.06 ms |
| 100 reorders | 5.21 / 5.33 ms | 3.10 / 3.45 ms |
| 20 pane close/split cycles | 3.47 / 3.63 ms | 2.96 / 3.31 ms |
| 100 detaches | 48.55 / 53.48 ms | 57.22 / 59.35 ms |
| 20 fresh splits | 10.68 / 11.10 ms | 8.91 / 9.21 ms |
| 100 shared listings | 0.94 / 1.59 ms | 1.26 / 1.83 ms |
| Persisted characters | 20,762 | 24,917 |

Resolving pane tabs through one cached key map replaced four linear scans per store update, which is why most operations got faster. Detaching got 11–18% slower across runs and the store about 20% larger because the active group now records every pane tab. No budget was changed.

Browser: `L8DB_TAB_BROWSER=1 bun test tests/tab-groups-browser.test.ts` passed once each in Playwright Chromium and WebKit against the production build (save, rename with pointer movement, cancel, commit by clicking outside the menu, overwrite, reopen after closing, open from another connection, close the group, reload, delete, switch connection).

Not covered: no Windows or Linux run, no WebView2, no CPU or heap throttling (not run on this Mac), no real database, no measurement of renderer heap or of the IndexedDB write that follows a store update. Groups whose query tabs were closed while another connection was active do not keep that SQL.

### Tab groups from another connection map the schema (2026-11-26)

Opening a group from another connection kept the source schema, so a group saved by Oracle user `APP_PROD` opened `APP_PROD.ORDERS` under `APP_TEST` and failed with ORA-00942 (MySQL: other database name). `openableGroup` (`src/lib/shared-tab-open.ts`) now checks each source schema once in the active connection and, when the object is missing there, maps it to the connection's own default schema (`retargetGroup`), like pasted tab links do. Copies made before the fix are repaired the next time they open. Opening a group of the own connection stays without any database request.

Limits: per source schema at most one `list_tables`/`list_views` in that schema and one in the own schema, at most one `list_schemas` per open, requests run one after another and never per tab; nothing is cached across opens; a connection switch during the check skips the mapping.

`tests/perf-tab-groups.test.ts` (scenario `tab-groups-schema-mapping`), same machine and runtime as above: 500 tabs in two panes (400 in `APP_PROD`, 100 in `SHARED`, every fifth a view), target lists 400 and 100 objects.

| Operation | Requests per open | Median / p95 | Gate (p95) |
| --- | --- | --- | --- |
| Copy, map, open, delete and close 500 tabs | 4 | 3.32 / 3.86 ms | 40 ms |
| Reopen the mapped copy | 2 | 0.81 / 0.83 ms | 10 ms |

Before the fix the same open sent no request and left 400 tabs in the wrong schema. Not covered: no real Oracle or MySQL database, network latency of the list calls is not part of the measurement, no Windows or Linux run, no CPU or heap throttling.

## Search across open SQL tabs

On macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10, searching 250,000 identical SQL lines for SELECT took 3.29 ms median and 6.11 ms p95 before incremental line scanning, then 0.09 and 0.12 ms. Each series used one warmup and 25 samples. The search returns the first 500 matches and confirms truncation at match 501. The regression in tests/tab-search.test.ts sets limits of 2 and 5 ms. These measurements cover the local search function. WebView rendering, database operations and other platforms were outside the workload.

## CSV delimiter detection

On the same Apple M3 with 16 GiB RAM, macOS 27.2.1 arm64 and Bun 1.3.10, the ten-record, 450,058-character multiline fixture in tests/csv-import.test.ts took 9.29 ms median and 22.31 ms p95 before the change. Skipping quoted fields and retaining four delimiter counts per sampled record took 0.029 and 0.058 ms over 25 warm samples. The regression budgets are 2 and 5 ms. Only local delimiter detection was measured.

## Command palette match highlighting

The 500-label fixture in tests/command-score.test.ts highlights two German search terms in each result, including names with an emoji before the match. On macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10, the 21 timed samples took 13.75 ms median and 25.04 ms p95 under shared system load. The budgets are 25 and 60 ms, with 1,000 returned ranges. The workload exercises the local highlighting function.

## Import column mapping

With 120 source columns and 120 targets, including one unmapped column, warm React server rendering on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10 took 58.45 ms median and 71.19 ms p95 before pagination and deferred menu creation. The final regression run took 15.56 and 36.03 ms with 20 visible selectors and 20 target type reads. Budgets are 45 and 100 ms, over 11 timed renders after warmup. Timing varied under concurrent host load. Chromium and WebKit separately exercised filtering, mapping the last unmatched column and paging to verify its new value on the same Mac. Desktop Tauri and database writes were outside these tests.

## Keyless result comparison

Two 999-row results with 40 string columns, repeated groups of four rows and a rotated row order took 22.56 ms median and 43.70 ms p95 before one-pass row matching, then 6.51 and 8.34 ms after (21 warm samples per series on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM, Bun 1.3.10, variable shared load). The regression in tests/perf-result-compare.test.ts counts exactly 1,998 key-cell reads for a single-column variant. This variant took 0.58 ms median and 0.79 ms p95 against limits of 12 and 30 ms. Both fixture results stay local, and the existing mixed-changes benchmark recorded zero database requests.

## Long text in CLI table previews

The CLI preview regression in cli::output formats 64 cells per sample, each holding 65,536 Unicode characters (112 KiB of UTF-8, including tabs and newlines). The original implementation exceeded the 5 ms median budget and the 22-sample benchmark took 23.09 s in the Rust test profile under shared host load. Borrowing text and inspecting at most 81 characters took 0.243 ms median and 0.368 ms p95 over 21 measured samples after warmup. Maximum observed output string capacity was 160 bytes. Limits are 5 ms median, 15 ms p95 and 640 bytes of output capacity. Measurements used macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and rustc 1.99.0. The test checks string preview formatting within the process, excluding database and terminal I/O.

## JSON Pointer copying

Formatting 500 paths of 33 segments, with slashes and tildes in every named segment, took 7.46 ms median and 14.02 ms p95 in 21 warm samples on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM, Bun 1.3.10. The budgets in tests/json-editor.test.ts are 15 and 40 ms. The formatter receives only the selected path. Browser tests exercised the status bar, row menu, root and read-only cells in Chromium and WebKit with an instrumented clipboard. Native clipboard and other operating systems were outside that test.

## Cancelled notebook exports

With 100 SQL cells and 1,000 in-memory rows per cell, cancelling a Markdown or HTML export previously accessed 20,000 result values per cancellation. Across alternating formats the median was 8.123 ms and p95 was 19.398 ms. Opening the save dialog first reduced both the result reads and file writes on cancellation to zero. The measured median was 0.002 ms and p95 was 0.005 ms. Tests used Bun 1.3.10 on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM, one warmup and 21 measured cancellations. The limits in tests/perf-notebook-export.test.ts are 3 ms median and 10 ms p95. The Tauri dialog and filesystem transport were simulated, so timings exclude native dialog and disk latency.

## Saving while editing a notebook

At revision 34d37af2, eight overlapping save requests for the same 5,000-cell notebook started eight filesystem writes. In tests/notebook-save.test.ts, one initial request and 22,000 repeated requests for the same snapshot shared one save dialog, one pending promise and one filesystem write. Across 21 measured batches after warmup, dispatching 1,000 repeat requests took 0.027 ms median and 0.227 ms p95 (limits 3 and 10 ms). The test covers a single window with a simulated pending native write on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10. It excludes disk latency and simultaneous writes from separate windows.

## S3 browser pagination

In tests/s3-object-pagination.test.ts the listing receives 50 pages of 1,000 objects. The last response repeats an earlier continuation token. Ten subsequent attempts to load more leave the total at 50 requests and 50,000 retained rows. Previously the browser offered any returned nonempty token again. On macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10, the 49 follow-up pages took 0.391 ms median and 1.139 ms p95, against limits of 15 and 50 ms. The transport was simulated. Chromium and WebKit covered keeping prior objects visible after an error, retrying the failed page and displaying the incomplete-list status. No live S3 provider was used.

During this change the separate server-render test of the unmodified ObjectList component retained 52 DOM rows for 50,000 objects but exceeded its existing timing budgets (126.4 ms median, 423.0 ms p95 against 50 and 120 ms). This measurement covers rendering rather than loading a page.

## Selecting entries in the S3 browser

For a list of 50,000 entries, a batch of 100 selection changes with four selected entries and one detail lookup each took 88.114 ms median and 157.702 ms p95 with the original list scans. The browser now indexes each distinct visible ID once whenever the visible list changes. After 50,000 initial row reads, the same batch required 500 row reads, 0.069 ms median and 0.104 ms p95 over 21 warm samples. The regression test in tests/perf-s3-object-list.test.tsx allows 5 ms median and 12 ms p95. These timings cover in-memory selection, detail lookup and folder counts on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10. Chromium and WebKit also exercised selection across filter changes with simulated S3 responses.

The separate 50,000-entry server-render scenario measured 7.4 ms median and 23.1 ms p95 before the indexing change and 7.2 ms median and 22.5 ms p95 afterward, with 52 DOM rows in both runs. The earlier timing overrun did not reproduce in the baseline.

## Cancelling a query-result JSON export

With a 1,000-row SQL preview and 200,000 available rows, dismissing the save dialog used to trigger one full query per export. Across 22 independent attempts the simulated database generated 4.4 million unused rows. The warm median was 1.788 ms and p95 was 5.921 ms. Choosing the destination first reduced the same workload to zero query requests, zero full-result rows and zero file writes. The median was 0.004 ms and p95 was 0.036 ms, against budgets of 3 and 10 ms. The hook test in tests/query-row-limit.test.tsx also checks concurrent export commands, cancelling an active read, successful output and retry after a dialog error. Measurements used Bun 1.3.10 on macOS 27.2.1 arm64, Apple M3 and 16 GiB RAM with simulated database, dialog and file transports.

Chromium and WebKit exercised the export menu with a 1,000-row preview and 1,200 total rows. One cancellation and two confirmed exports triggered one full-result read and produced two complete JSON documents. The grid performed its usual separate row count.

## Searching history and saved queries

With 5,000 entries in each tab, 22 searches per tab previously accessed 110,000 names or SQL texts in the hidden list. Scoping search to the selected tab reduced those accesses to zero in Chromium and WebKit. Clearing the search kept fewer than 100 list rows mounted. Searching, switching tabs and clearing the filter issued zero database requests.

The browser test in tests/perf-query-history.test.ts measures from filling the search field to observing the matching row. Times below are milliseconds, with one warmup and 21 measured searches per tab. Limits are 60 ms median and 120 ms p95. Runs used an unthrottled Vite development server with simulated Tauri transport on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10.

| Browser and tab | Previous median / p95 | New median / p95 |
| --- | ---: | ---: |
| Chromium, history | 5.99 / 9.41 | 5.08 / 7.79 |
| Chromium, saved | 5.68 / 7.30 | 4.78 / 7.03 |
| WebKit, history | 8.80 / 12.72 | 8.40 / 10.72 |
| WebKit, saved | 6.40 / 7.78 | 6.08 / 7.73 |

With the Vite development server running locally, use `L8DB_QUERY_BROWSER_URL=http://127.0.0.1:1420 bun test tests/perf-query-history.test.ts -t 'Query-Bibliothek durchsucht'`. Add `L8DB_QUERY_BROWSER_ENGINE=webkit` for the WebKit run.

Two existing Chromium scenarios also ran against fresh production builds of this change and its parent d884bb2f. The nested import scenario saw the imported entry but timed out waiting for its success notification on both builds. The history scenario recorded zero database requests and one unclassified `cli_status` request on both builds, failing its zero-unknown-request assertion. The first run on the changed build also timed out reopening the tools menu. The isolated rerun reached the request-count assertion.

## Detecting providers for local file paths

The local-path scenario in tests/connections.test.ts resolves 4,096 paths per batch across eight file extensions, with up to 19 nested directories. Before the change the registry lookup tried to construct a network URL for each path, and four DuckDB text formats resolved to SQLite. With one warmup and 21 measured batches, detection took 5.413 ms median and 9.202 ms p95. Using the unique file-based provider directly required zero URL constructions and zero Tauri calls. The median was 1.274 ms and p95 was 2.901 ms, within limits of 12 and 32 ms. These are in-memory detection timings on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM, Bun 1.3.10 and a simulated provider registry. The functional cases include Windows drive paths and explicit SQLite schemes.

## Writing CLI results as Markdown

The Markdown formatter writes a header, a delimiter and one line per data row. For 10,000 three-column rows containing Unicode, ampersands, pipes and CRLF, it took 15.99 ms median and 19.36 ms p95 across 21 warm runs. The longest write was 60 bytes and the reusable buffer for a representative row had 64 bytes of capacity. Limits are 75 ms median, 150 ms p95, writes below 128 bytes and buffer capacity up to 256 bytes for this fixture. A separate case closes the output after the first data row. The formatter stops on the next write and consumes only two of 100,000 available rows.

Run `cargo test --lib cli::output::markdown -- --nocapture --test-threads=1` in `src-tauri`. Measurements used the unoptimized Rust 1.99.0 test profile on macOS 27.2.1 arm64, Apple M3 and 16 GiB RAM. They cover formatting and writes to an in-memory sink. The database adapter can hold the query result separately, and wider rows increase the line buffer. The initial character-by-character implementation exceeded the p95 limit in a parallel CLI suite run (168.39 ms). The timings above use the final implementation and a serial run.

## Resolving CLI file options

Resolving 512 existing local SQLite paths with four different option strings took 2.94 ms median and 3.34 ms p95 over 21 warm batches. The CLI retained the requested read-only state for 384 paths and the ordinary access mode for the other 128. Each returned URL was dropped before resolving the next one. The largest URL capacity was 158 bytes. The regression test permits 25 ms median, 60 ms p95 and at most twice the input length plus 16 bytes of URL capacity.

Run `cargo test --lib cli::connect::tests::file_options_bound_resolution_cost -- --nocapture` in `src-tauri`. These timings cover local filesystem metadata and URL resolution without opening a database connection. Separate tests exercise real SQLite and DuckDB connections and the TUI write protection. Measurements used the unoptimized Rust 1.99.0 test profile on macOS 27.2.1 arm64, Apple M3 and 16 GiB RAM.

## Grouping connections by host rules

With 1,024 PostgreSQL connection entries and 16 two-pattern rules, the connection manager produced 32 groups. Half of the connections matched a rule. The original grouping compiled 25,088 regular expressions per pass. The rule editor independently recomputed the winning rule for each counter, compiling 401,408 expressions. Each rule now keeps its compiled patterns in a weakly keyed cache. All 16 rules together compiled 32 expressions on first use, zero on an unchanged pass and one when replacing a rule with a single new pattern. Connection URLs are read once per entry per pass. The preview stores one count per matching rule.

| Operation | Previous median / p95 | New median / p95 | Previous / new URL reads per pass |
| --- | ---: | ---: | ---: |
| Group connections | 11.98 / 12.72 ms | 1.56 / 1.69 ms | 2,576 / 1,024 |
| Preview all rule counts | 182.79 / 188.56 ms | 1.36 / 1.42 ms | 32,768 / 1,024 |

The in-memory measurements used one warmup and 21 timed passes on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10. Run `bun test tests/host-group-rules.test.ts`. The budgets for either pass are 10 ms median and 24 ms p95. A separate production-build browser check used simulated connections in Chromium and WebKit. Reordering overlapping rules, editing a pattern, saving and discarding an edit issued zero database requests.

The existing 200-tab environment marker test in tests/perf-split-groups.test.ts observed one `list_providers` call when run individually, failing its zero-request assertion on both the parent commit 55f2057b and the changed code.

## Searching saved connections by group

The connections page builds a sorted list when the saved profiles, cloud profiles, host rules, favorite groups or custom group order change. A search can match the whole visible group label or individual profile metadata. The first metadata search builds at most one search string per listed profile. Clearing the filters reuses the full list.

With 2,048 PostgreSQL profiles, 16 host rules and 22 successive searches alternating between all profiles and favorites, the previous view logic read connection URLs 136,389 times. Preparing the new list and running all searches required 4,096 reads, including the first search. The previous implementation returned zero results for the group name `Fachbereich 12`. The new one returned its 64 profiles. After one warmup, filtering took 0.34 ms median and 9.74 ms p95, compared with 25.68 ms and 44.31 ms for the previous filtering and regrouping path. The regression limits are 6 ms median and 16 ms p95. These timings cover in-memory work on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10.

Run `bun test tests/connection-listing.test.ts`. Chromium and WebKit also exercised group renaming, search, clearing a failed favorite search and finding a cloud project on the production build with simulated connections. Repeated searches for one profile did not parse a hidden profile's URL or issue database queries.

For 256 saved profiles, the time from a browser input event to the matching card appearing in the DOM was measured on the two production builds in alternating order. Across 41 measured searches, Chromium went from 2.9 / 3.5 ms median / p95 to 1.9 / 3.3 ms. WebKit went from 4 / 5 ms to 3 / 4 ms. A separate sequential Playwright measurement included input automation and waiting for the one-card assertion. Its p95 increased from 25.15 to 69.35 ms in Chromium and from 58.64 to 98.93 ms in WebKit. That run does not establish an improvement in overall automation time.

## Browsing cloud projects in the connection directory

With 257 simulated Appwrite projects and zero saved SQL profiles, both Chromium and WebKit mounted 257 cards in the previous production build. The search field and profile import action were absent. The updated directory mounts at most 24 cloud cards. Searching by project name, provider or endpoint includes all pages.

The regression test visits all 11 pages in both directions and records 20 transitions from click to the first animation frame with the expected card. Chromium took 22.9 ms median and 26.9 ms p95. WebKit took 55 ms median and 62 ms p95. The limits are 150 ms median and 350 ms p95. Paging, searching and opening the import dialog issued zero additional database queries or project-list requests. The test also covers keyboard navigation and the transition from a mixed directory to a cloud-only directory while the favorites filter is active.

Run `L8DB_CLOUD_PROJECTS_BROWSER_URL=http://127.0.0.1:1420 bun test tests/cloud-project-directory-browser.test.ts` against a local frontend. Measurements used a production Vite build on macOS 27.2.1 arm64, Apple M3, 16 GiB RAM and Bun 1.3.10 with a simulated Tauri transport.

## Matching cloud projects to saved SQL profiles

With 1,024 saved PostgreSQL profiles, the directory linked 128 Supabase Cloud projects and 64 self-hosted Supabase projects to their SQL profiles. It also listed 64 Appwrite projects and 832 independent SQL profiles. Previously, building the listing and resolving each of the 256 cards once read the connection strings 182,272 times. A single matching pass and the usual grouping of independent profiles now use 1,856 reads. Looking up the cards then adds zero reads. The directory retains one SQL profile per matched project. When several profiles match, the first saved profile still backs the card.

Over 21 timed runs after one warmup, the median fell from 70.29 ms to 1.65 ms and p95 from 74.14 ms to 4.90 ms. The regression budgets are 10 ms median and 25 ms p95 for building the listing and looking up every card. Run `bun test tests/connection-listing.test.ts`. Measurements used Bun 1.3.10 on macOS 27.2.1 arm64, Apple M3 and 16 GiB RAM. The cloud directory browser test also opens the matching SQL profile editor and distinguishes self-hosted projects with different names on the same host, using simulated profiles in Chromium and WebKit.
