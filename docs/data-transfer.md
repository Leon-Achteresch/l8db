# Data transfer and comparison limits

CSV export writes into an automatically cleaned temporary file in the destination directory. It flushes and synchronizes that file before atomically replacing the destination with `tempfile::NamedTempFile::persist`. Abort, query errors, failed writes and failed replacement preserve an existing destination. See [tempfile's persist contract](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html#method.persist).

PostgreSQL CSV export uses a forward-only cursor in a dedicated read-only repeatable-read transaction, with batches of 1,000 rows. One extra row distinguishes an exact limit from actual truncation; the maximum remains five million rows. A transaction rollback closes the cursor on completion or failure. The dedicated connection also prevents an abandoned future from returning an open transaction to the pool.

Full XLSX exports read a PostgreSQL snapshot in the backend before workbook generation. Connection, database, filter and ordering are captured for the request. Tables use `ctid` as a stable tie-breaker within the snapshot. Each batch has 1,000 rows; at most 64 MiB of serialized JSON row data and the Excel row limit are admitted. This raw-data limit is not a claim that total process RSS is 64 MiB: decoded objects and workbook construction require additional memory. Unsupported providers reject full snapshot export explicitly; exporting already loaded rows remains available. Cancellation closes the dedicated read session and stops workbook generation.

CSV file imports preview at most 2 MiB in the frontend and pass the selected path plus mapping to Rust. The backend checks the Tauri filesystem scope and streams UTF-8 records from a buffered file reader into prepared PostgreSQL statements within one transaction. Delimiter and quote options accept individual Unicode characters. Limits are 1 GiB per file and 1 MiB per CSV record; quoted multiline fields and escaped quotes can cross reader-buffer boundaries. The record parser retains quoted empty strings and ignores physically empty lines. Exceeding a limit or encountering malformed CSV or a database error rolls the import back. Cancellation uses the existing confirmed PostgreSQL cancellation path. The small in-memory IPC API retains its 10,000-row limit.

Imports default to plain INSERT and atomic failure on conflicts. Explicit conflict handling uses a selected non-deferrable primary/unique constraint. All conflict columns must be mapped. An empty update-column list means skip; a nonempty list updates only those mapped columns. Generated, identity and conflict-key columns cannot be selected for updates. PostgreSQL still validates actual insertability, including identity rules. Counts report inserted, updated and skipped rows, and are zero after rollback. Constraints not selected as the conflict target still fail the transaction.

Data comparison reads each side using its own backend snapshot, independently in time. Optional validated WHERE filters define a partial comparison and are saved with the workspace. Primary keys are the default; explicitly selected composite keys are checked for NULL, missing values and duplicates across the complete selected input. Up to one million rows and 64 MiB serialized raw data per side are supported. Backend maps are bounded by these input limits; decoded objects and indexes consume additional RAM. Inputs exceeding either limit fail rather than reporting equality from a sample.

The comparison counts every row but transfers only differences to the frontend. Details are capped at 10,000 rows and 16 MiB serialized data; reaching this cap is visible. Any generated sync script contains only displayed, selected differences. Aborted comparisons produce no completed result or sync script. Identical rows are counted without transferring them. Task progress reports rows read on the current side and allows cancellation. Independent source snapshots do not represent a shared cross-database instant.

MySQL/MariaDB, SQL Server and SQLite use the same limits through `DatabaseAdapter::snapshot_rows`, streaming one result set row by row. MySQL reads inside `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`. SQL Server reads one statement with the session's isolation level, which is not a snapshot unless the database enables snapshot isolation. SQLite reads one statement on the shared connection. MySQL decimals keep their exact text. Sync scripts use literals for each dialect:

- MySQL: backslash escaping and `X''` binaries.
- SQL Server: `N''` strings, `0x` binaries and ISO timestamps.
- SQLite: `X''` blobs.
- Booleans become `1`/`0`.

UPDATE staleness checks use NULL-safe comparisons: `IS NOT DISTINCT FROM`, `<=>`, `IS`, or `IS NULL`/`=`. Approximate and non-comparable types are left out of that check: float, SQL Server `text`/`xml`, and MySQL JSON/spatial. SQL Server inserts run as one batch. If the table has an identity column, the batch is wrapped in `IDENTITY_INSERT`. DELETE statements for rows present only in the target are generated only when explicitly enabled. Oracle data comparison is not supported.

Schema comparison for these families reads `information_schema` (MySQL), `sys` catalog views (SQL Server) and `sqlite_master`/`PRAGMA` (SQLite). MySQL DDL auto-commits, so MySQL sync scripts have no dry run and run statement by statement. SQL Server and SQLite run inside a transaction with rollback dry runs. SQLite column changes rebuild the table (copy, drop, create, reinsert) with deferred foreign keys.

## Reproduction

The multi-family live suites need the Rust bridge (`L8DB_SCHEMA_COMPARE_BRIDGE_PORT=<port> cargo test --lib schema_compare_bridge -- --ignored`). Set `L8DB_SCHEMA_COMPARE_LIVE=http://127.0.0.1:<port>`, `L8DB_SC_MYSQL_URL` and `L8DB_SC_MSSQL_URL`; SQLite uses temporary files. `bun test tests/schema-compare-live-multi.test.ts tests/data-compare-live-multi.test.ts` checks that compare, apply and a second compare converge.

`bun run test:integration` provisions the isolated lab and checks 100,000-row CSV import with multiline values, a late error, cancellation, composite-key conflict strategies, snapshot consistency during concurrent writes, and 100,000 rows per comparison side with filters and cancellation.

`L8DB_BENCHMARK=1 bun run test:integration` additionally compares the previous LIMIT/OFFSET algorithm against the cursor using 100,000 and one million rows, identical CSV writing, deterministic ordering and 1,000-row batches. The benchmark prints timings and the platform's `/usr/bin/time` resource report. Measurements are development-build results on a local Docker lab, not production throughput guarantees.

Measured on 2026-09-21, macOS development build, local PostgreSQL 18 Docker lab:

| CSV rows | Previous OFFSET | Cursor |
| --- | ---: | ---: |
| 100,000 | 3.552 s | 0.736 s |
| 1,000,000 | 280.714 s | 10.263 s |

The benchmark process reported 206,192,640 bytes maximum resident set size across both algorithms and dataset sizes. This is a combined process peak, not a separate per-algorithm memory comparison. Both algorithms keep only one 1,000-row batch at a time. The 100,000-row streamed import took 21.9 seconds in the integration run, and the 100,000-row-per-side comparison took 2.1–3.1 seconds. Run `L8DB_MEASURE=1 bun run test:integration` for resource reports of individual test suites after compilation.

The measured integration run reported 205,094,912 bytes maximum RSS for the large CSV import suite (including its late-error and cancellation passes), and 213,909,504 bytes for the large comparison suite. These are whole debug-test-process measurements, including Tauri/Rust runtime overhead. The import took 30.37 seconds and the comparison 2.15 seconds in that run; other local work was active.
