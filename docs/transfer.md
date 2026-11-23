# Database transfer

"Transfer" copies complete schemas — structure and data — from one connection into another, within the same database family or across families. Backend: `src-tauri/src/db/transfer.rs` (`plan_transfer`, `run_transfer`). Frontend: `src/features/transfer/`, route `/transfer`. Supported families as source and target: PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, SQLite, DuckDB and ClickHouse (every family with an import `Dialect`). Document stores and key/value systems (MongoDB, Redis, Cassandra, …) have no relational structure to transfer and are out of scope.

A transfer runs in two steps. `plan_transfer` reads the source and returns a plan with DDL statements per phase, the table load order, column mappings, warnings and objects that need manual work. The UI shows the plan; `run_transfer` executes exactly this plan.

## Selection and scope

- **Schemas and tables.** Every checked schema has a table dropdown ("Tabellen" column). By default all tables are transferred; the dropdown (search, virtualized list, "Treffer wählen", "Alle", "Keine") narrows a schema to chosen tables (`SchemaPair.tables`, `None` = all). With a table selection only those tables move, together with their columns, keys, indexes, constraints, triggers, comments and grants. Foreign keys to tables that are not selected are dropped with a plan warning. Sequences, object types, functions, procedures and packages whose names appear in the DDL of the chosen tables and their parts (defaults, triggers, column types) are kept, transitively, so a trigger keeps the package it calls; views and unreferenced objects are not transferred. PostgreSQL partitions of a chosen partitioned table are added to the selection. Selected tables that no longer exist in the source are skipped with a warning; an empty selection is rejected.
- **Scope ("Umfang", `PlanRequest.content`).** `all` (default) creates structure and loads data. `structure` runs only the DDL phases and opens no source reader. `data` loads into existing, empty target tables: the plan contains no DDL, fails when a target schema or table is missing, reads foreign keys to load parents first, keeps identity handling (identity columns of the Oracle target tables that are `GENERATED ALWAYS` are switched to `BY DEFAULT` for the load and restored with `START WITH LIMIT VALUE`; the target's own identity settings are kept) and sequence sync. Enabled Oracle triggers on the target tables are disabled for the load and re-enabled afterwards, so the copied rows are not changed again; other families keep their triggers active and the plan warns about it. Before writing, every target table is checked to be empty. On targets without transactional DDL (Oracle, MySQL, ClickHouse) a failure deletes the rows of already loaded tables in reverse load order and restores identity settings.
- Overwrite (section 5) is only available for `all`/`structure` without a table selection.

## Planning large databases

Planning reads the source catalog once per schema instead of once per table:

- **Oracle source:** one dedicated connection streams a handful of schema-wide dictionary queries (`ALL_TAB_COLS`, `ALL_CONSTRAINTS`/`ALL_CONS_COLUMNS`, `ALL_INDEXES`/`ALL_IND_COLUMNS`, foreign keys, and defaults only for mapped transfers, since `DATA_DEFAULT` is a `LONG` and prevents array fetches), 1,000 rows per round trip. Previously every table cost three to six dictionary queries.
- **Other sources:** per-table catalog reads run with at most 8 in flight and without the duplicate constraint read.
- Load order, table lookups, identity/materialized-view matching and conflict checks are linear (`load_order` is Kahn's algorithm with the previous tie-breaking).
- A plan runs as a cancellable job; the UI cancels an abandoned plan when the selection changes.

Measured with `transfer_live_oracle_plan_budget` on macOS 27.0, Apple M3 (8 cores, 16 GB), Oracle AI Database 26ai Free 23.26 in Docker (`gvenzl/oracle-free:23-slim`, arm64), debug build, 1,502 tables (each with primary key, foreign key, unique key, check and index): the old per-table read took 63.9–67.4 s; the complete plan now takes 0.23–0.33 s median and 2.0–3.2 s p95 (first, cold run) over five runs, a two-table selection 0.18–0.26 s, peak RSS +22–31 MiB, cancellation 32–101 ms (three test runs). The test also checks that the bulk reader returns exactly what the per-table reader returns. Other database families, Linux, Windows and release builds were not measured.

## 1. Type conventions

There are two modes, chosen automatically:

**Native (same family).** Source and target are the same family (PostgreSQL→PostgreSQL, Oracle→Oracle, MySQL→MySQL, SQL Server→SQL Server, SQLite→SQLite). Structure is taken verbatim from the schema catalog (`schema_catalog`, the same source as schema compare) and turned into an ordered creation script by the schema-compare script builder (`buildSyncScript`, source against an empty target). Types, defaults, identity/serial, enums, domains, arrays, generated columns and partitioning stay native; nothing is mapped. Schema qualifiers are rewritten from the source to the target schema (`requalify`).

**Mapped (cross family).** Every column type is mapped through a canonical type set (`table_copy::Canonical`) into the target family (`table_copy::render`):

| Canonical | PostgreSQL | MySQL | SQL Server | Oracle | SQLite | DuckDB | ClickHouse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bool | boolean | TINYINT(1) | BIT | NUMBER(1) | BOOLEAN | BOOLEAN | Bool |
| SmallInt / Int / BigInt | smallint / integer / bigint | SMALLINT / INT / BIGINT | SMALLINT / INT / BIGINT | NUMBER(5/10/19) | SMALLINT / INTEGER | SMALLINT / INTEGER / BIGINT | Int16/32/64 |
| Decimal(p,s) | numeric(p,s) | DECIMAL(p,s) (p ≤ 65) | DECIMAL(p,s) (p ≤ 38) | NUMBER(p,s) (p ≤ 38) | NUMERIC(p,s) | DECIMAL(p,s) | Decimal(p,s) |
| Real / Double | real / double precision | FLOAT / DOUBLE | REAL / FLOAT | BINARY_FLOAT / BINARY_DOUBLE | REAL | REAL / DOUBLE | Float32/64 |
| Char/Varchar(n) | char/varchar(n) | CHAR/VARCHAR(n), LONGTEXT above 16,383 | NCHAR/NVARCHAR(n), MAX above 4,000 | CHAR/VARCHAR2(n CHAR), CLOB above 4,000 | VARCHAR(n) | VARCHAR(n) | String |
| Text / Json | text / jsonb | LONGTEXT / JSON | NVARCHAR(MAX) | CLOB | TEXT | VARCHAR | String |
| Date / Time | date / time | DATE / TIME(6) | DATE / TIME | TIMESTAMP(6) / VARCHAR2(32) | DATE / TIME | DATE / TIME | Date32 / String |
| Timestamp / TimestampTz | timestamp / timestamptz | DATETIME(6) | DATETIME2 / DATETIMEOFFSET | TIMESTAMP(6) [WITH TIME ZONE] | TIMESTAMP | TIMESTAMP / TIMESTAMPTZ | DateTime64(6) |
| Binary | bytea | LONGBLOB | VARBINARY(MAX) | BLOB | BLOB | BLOB | String |
| Uuid | uuid | CHAR(36) | UNIQUEIDENTIFIER | VARCHAR2(36) | TEXT | UUID | UUID |

Conventions and deliberate losses, all reported as plan warnings:

- Oracle `DATE` carries a time and maps to Timestamp. Oracle `NUMBER` without precision maps to the widest exact decimal of the target. Oracle `NUMBER(p,0)` maps to the smallest integer type that holds p digits (≤ 4 SmallInt, ≤ 9 Int, ≤ 18 BigInt), wider scales stay decimal.
- Foreign key columns take the type of the referenced column, so both sides of a key always match in the target.
- Decimals wider than the target limit become text rather than being rounded.
- Unsigned integers widen to the next signed type (`int unsigned` → BigInt); `bigint unsigned` becomes Decimal(20,0).
- Time zones are lost for MySQL, SQLite and ClickHouse; values are normalized to UTC before insertion.
- Arrays, enums, domains, ranges, spatial types, XML, intervals and other types without a canonical counterpart become text in their source text representation.
- Keyed text columns (primary key, unique, index, foreign key) get a bounded type where the target cannot index unbounded text (MySQL VARCHAR(255), SQL Server NVARCHAR(450), Oracle VARCHAR2(1000 CHAR)).
- Oracle stores the empty string as NULL. A NOT NULL text column that contains `''` fails with the row reported, and the transfer rolls back. Values are never rewritten silently.
- Identity/auto-increment columns are recreated with the target's identity mechanism: PostgreSQL `GENERATED BY DEFAULT AS IDENTITY`, MySQL `AUTO_INCREMENT`, SQL Server `IDENTITY(1,1)`, Oracle `GENERATED BY DEFAULT ON NULL AS IDENTITY`, SQLite `INTEGER PRIMARY KEY`. DuckDB and ClickHouse have no identity columns; the column is copied with its values and a warning is reported.
- Defaults are transferred when they are a literal (number, string, boolean) or the current timestamp. Expression defaults and generated-column expressions are dialect SQL and are reported instead. Generated columns become plain columns with their values.
- Identifier case: with "Namen an Zielkonvention anpassen" (on by default across families), simple identifiers are folded to the target's unquoted convention (Oracle upper case, PostgreSQL lower case) so they can be used without quotes. Collisions after folding abort the plan. Names that exceed the target limit (PostgreSQL 63, Oracle 128) abort the plan.

Reading values: exact numerics are read as text in the source (`CAST(… AS CHAR)`, `CONVERT(NVARCHAR(100), …)`, `TO_CHAR(…, 'TM9')`, `toString(…)`), because the adapters' JSON conversion goes through `f64`. Oracle dates and timestamps are formatted to ISO text explicitly. Binary values travel as `\x` hex everywhere.

## 2. Database-specific objects

Tables, columns, primary keys, unique constraints, indexes, foreign keys and standalone sequences are portable and transferred in both modes.

Code objects (views, materialized views, functions, procedures, Oracle packages and package bodies, object types and type bodies, triggers, synonyms, MySQL events, SQL Server modules) are dialect code. They cannot be translated mechanically: PL/SQL packages have package state, overloading, `%TYPE`/`%ROWTYPE`, autonomous transactions and `DBMS_*` APIs that have no equivalent in T-SQL, PL/pgSQL or MySQL's procedure language.

- **Native mode** transfers them in full: the catalog DDL is executed on the target in dependency order (types → sequences → tables → constraints → views (dependency-sorted) → package specifications → functions/procedures → package bodies/type bodies → triggers → comments). Oracle objects are compiled on creation; invalid objects are reported after the run through the existing invalid-object check. Grants are not transferred, because roles and users are server-level objects that usually differ between source and target. Exception: Oracle → Oracle transfers object grants as optional statements; a grant whose grantee does not exist in the target becomes a warning instead of failing the run (see section 5).
- **Mapped mode** never executes source dialect code on the target. Every such object appears in the plan under "Manuell nachziehen" with its type, name, reason and source DDL, so it can be ported by hand (or with the SQL editor) after the transfer. Check constraints are also listed there; they are dialect expressions.
- Oracle specifics: package specification and body are separate objects and created in that order. `ISEQ$$_` identity sequences are skipped, since identity columns recreate them. Synonyms pointing into other schemas are created as-is and may be invalid until those schemas exist.
- PostgreSQL specifics: extensions are not installed. Objects that depend on an extension type fail in the plan preview and are reported. `OWNED BY` for sequences is restored.
- Partitioning: in native mode, PostgreSQL and Oracle partitioning is kept (`schema_partition_ddl` fills in missing partition clauses). In mapped mode, partitioned tables are created unpartitioned.

## 3. Performance without hitting constraints

The order follows what `pg_dump`/`pg_restore` do:

1. **Pre-data:** schemas, types, sequences and tables. Tables are created without foreign keys, secondary indexes, check constraints and triggers. For PostgreSQL, SQL Server and Oracle, the primary key is also added after the load. MySQL/InnoDB keeps the primary key inline, because it clusters rows by primary key: adding it afterwards rebuilds the whole table, and `AUTO_INCREMENT` requires a key. SQLite and DuckDB cannot add constraints to existing tables, so their keys and foreign keys stay inline.
2. **Data:** since no foreign keys exist yet, tables load in any order and no constraint check or trigger fires. Tables are still loaded parents-first (topological order by foreign key) because DuckDB enforces inline foreign keys immediately; foreign-key cycles are loaded in plan order. SQLite uses `PRAGMA defer_foreign_keys = ON`, so inline foreign keys are checked once at commit.
3. **Post-data:** primary keys, unique constraints, indexes, foreign keys, views, code objects and triggers. Each index is built once over the full data set instead of being maintained per row. Each foreign key is validated in one pass, which also proves referential integrity of the copied data.
4. **Finalize:** sequences and identity counters are moved past the copied values (PostgreSQL `setval`, Oracle `START WITH LIMIT VALUE`, standalone sequences from the source's current value). SQL Server, MySQL and SQLite move their counters automatically on explicit inserts.

Data path: the source is read in pages of 5,000 rows. PostgreSQL uses a server-side cursor (`DECLARE … NO SCROLL CURSOR`, `FETCH FORWARD`). Other sources use keyset pagination on a single-column primary key, and ordered `OFFSET` pages otherwise. Rows are written as multi-row INSERT batches through the shared import writer (`import::BatchWriter`: Oracle 100, SQL Server 500, ClickHouse 5,000, otherwise 1,000 rows or 2 MiB of SQL), with explicit identity values (`OVERRIDING SYSTEM VALUE` for PostgreSQL, `IDENTITY_INSERT` for SQL Server). No per-row round trip is made; a failing batch is replayed row by row only to name the exact failing row.

What is deliberately not done: disabling constraints or triggers on existing objects (`session_replication_role`, `FOREIGN_KEY_CHECKS=0`, `NOCHECK`). These need elevated rights, and they leave the database without integrity checks if the run dies halfway. Because the transfer creates the constraints itself after the load, nothing needs to be disabled. Exception: "Nur Daten" into Oracle disables the enabled triggers of the target tables (`ALTER TRIGGER … DISABLE`, needs `ALTER ANY TRIGGER` for foreign schemas) and re-enables them at the end, also after a failed run; if the app process dies during the load, they stay disabled.

## 4. Consistency: never half a database

**Consistent source.** All tables are read from one source snapshot, so parent and child rows match even when the source is written to during the transfer:

| Source | Snapshot |
| --- | --- |
| PostgreSQL | One `REPEATABLE READ READ ONLY` transaction for all tables |
| MySQL | `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` |
| Oracle | `SET TRANSACTION READ ONLY` (long runs need sufficient undo retention, otherwise ORA-01555 aborts and rolls back) |
| SQL Server | `SNAPSHOT` isolation if the database allows it; otherwise a warning that concurrent writes are not isolated |
| SQLite, DuckDB | One read transaction |
| ClickHouse | No transactions; a warning is reported |

**Atomic target.** The strategy depends on whether the target has transactional DDL:

- **PostgreSQL, SQL Server, SQLite, DuckDB:** the entire transfer (DDL, data, indexes, foreign keys, sequence sync, verification) runs in **one target transaction**. Any error, cancellation or app crash leaves the target unchanged: the transaction is rolled back, or never committed if the connection drops. Only the explicit commit at the very end makes the copy visible — all or nothing. Creating a missing target schema is part of the same transaction.
- **Oracle, MySQL, ClickHouse:** DDL commits implicitly, so a single transaction is impossible. Each table's rows are loaded in its own transaction, and every successfully executed creating statement is recorded in a journal. On error or cancellation, the journal is compensated in reverse order (`DROP … CASCADE CONSTRAINTS PURGE`, `DROP TABLE a, b, …`, `DROP PACKAGE`, …). A target schema created by the transfer (MySQL/ClickHouse database) is dropped as a whole instead. Objects that cannot be removed are reported as leftovers in the result. If the app itself dies in this mode, the leftovers remain; the next plan detects them in the preflight check.

**Preflight.** Before anything is written, the target is checked:

- target connection writable
- target schemas exist or can be created
- none of the planned tables, views, sequences or code objects already exists

A conflict aborts with the list of conflicting names. The transfer never overwrites or merges into existing objects, and compensation only ever drops objects the same run created. The only exception is the explicit overwrite mode for Oracle → Oracle (section 5).

**Verification.** After the load, every target table is counted inside the target transaction (or right after its load, when there is no global transaction). The count must equal the number of rows read from the source snapshot, otherwise the run fails and rolls back. Foreign keys created in post-data validate referential integrity. The result lists rows per table, the atomicity mode used and any leftovers.

## Limits

- Single statements are subject to the query timeout (at most 300 s). Very large index builds or foreign-key validations may need a higher timeout in the settings or a manual index build.
- Oracle binary values above the SQL literal limit (2,000 bytes for `HEXTORAW`) and SQL Server rows above the batch literal size load slowly or fail when Oracle is only one side of the transfer. SQL Server batches are 500 rows. Oracle → Oracle binds values and has no literal limit.
- Views, materialized views and code objects in mapped mode are listed for manual porting and not translated.
- Users, roles, grants, tablespaces, database links, jobs and server configuration are not transferred.

## Tests

`cargo test transfer` runs the unit tests plus live SQLite → DuckDB and SQLite rollback tests. The ignored live tests need throwaway databases, passed as env vars:

- `L8DB_TR_PG_URL` (required for the matrix), `L8DB_TR_MYSQL_URL`, `L8DB_TR_ORACLE_URL`, `L8DB_TR_MSSQL_URL`
- `L8DB_TR_ORACLE_SYSTEM_URL` for `transfer_live_oracle_native_packages` (creates and drops the users `TR_SRC` and `TR_DST`), `transfer_live_oracle_bulk_budget` (users `TR_PERF_SRC`/`TR_PERF_DST`, row count via `L8DB_TR_ORACLE_PERF_ROWS`, default 100,000) and `transfer_live_oracle_plan_budget` (users `TR_BIG_SRC`/`TR_BIG_DST`, table count via `L8DB_TR_ORACLE_PLAN_TABLES`, default 1,500; plan speed against the per-table path, equality of both readers, cancellation, memory, and "Nur Daten" with a table selection including failure cleanup)

```sh
cargo test --lib transfer_live -- --ignored --test-threads=1
```

`transfer_live_oracle_bulk_budget` copies 100,000 rows (`NUMBER`, `VARCHAR2`, `TIMESTAMP`, `TIMESTAMP WITH TIME ZONE`, `RAW`, every tenth row a 4 KB `CLOB`) Oracle → Oracle, cancels a first run after the first batch and checks the cleanup, then verifies content hashes of both sides. Budgets: at most rows / 500 + 1 array inserts (`V$SQL` executions), peak RSS growth below 64 MiB, batch p95 below 500 ms, more than 5,000 rows/s, cancellation below 2 s. Measured on macOS 27.0.1, Apple M3 (8 cores, 16 GB), Oracle AI Database 26ai Free 23.26.3 in Docker (`gvenzl/oracle-free:23-slim`, arm64), debug build, five runs: 3.7–5.1 s (19,400–27,300 rows/s), batch median 14–20 ms and p95 21–43 ms, 199 array inserts, peak RSS +12–17 MiB, cancellation reacted in about 20 ms and left nothing behind. The previous text path was not measured for comparison; Linux, Windows, release builds and other Oracle versions were not measured.

The overwrite backup is covered by `transfer_live_oracle_overwrite_restores_previous_state` (needs `L8DB_TR_ORACLE_URL` and `L8DB_TR_ORACLE_SYSTEM_URL`; users `TR_BK_SRC`/`TR_BK_DST`; a target with tables, named constraints and indexes, an index-organized table, identity and `CLOB` columns, a materialized view with log, views, synonym, type, function, package, enabled and disabled triggers and grants is overwritten as schema owner, as `SYSTEM` and with a table selection; each failing run must leave objects, constraints, indexes, triggers, grants, columns, row counts and the sequence position exactly as before), `transfer_live_mysql_overwrite_restores_previous_state` (`L8DB_TR_MYSQL_URL`) and `transfer_live_clickhouse_overwrite_restores_previous_state` (`L8DB_TR_CLICKHOUSE_URL`). Measured on macOS 27.0, Apple M3 (8 cores, 16 GB), debug build, databases in Docker on the same machine: Oracle AI Database 26ai Free 23.26 with 157 tables (150 of them with a named primary key, check constraint and index, about 760 renames): failed run including restore 2.7–5.6 s as owner or `SYSTEM`, 1.3–3.2 s for a one-table selection, successful run including dropping the backup 2.3–3.8 s (three test runs) (the test fails above 120 s; `L8DB_TR_ORACLE_BACKUP_TABLES` sets the table count); MySQL 8.4 with three tables: 0.5–0.6 s; ClickHouse 25.8: 0.3 s. Renames run one statement per object, so the time grows linearly with the number of tables, named constraints and indexes. MariaDB, larger schemas, remote databases, Linux, Windows and release builds were not measured.

`sqlite_to_duckdb_selected_tables_structure_then_data` covers table selection, "Nur Struktur" and "Nur Daten" locally. `tests/perf-transfer-selection.test.tsx` bounds the table dropdown (50,000 tables render 19 rows) and the catalog filter for a table selection (652,000 catalog objects in about 25–30 ms).

The complete Oracle → Oracle path (every object type, every value, overwrite, failure cleanup, table selection with "Nur Struktur" followed by "Nur Daten") is covered end to end by `tests/oracle-transfer-browser.test.ts`, which drives the real UI against the Oracle lab (`bun run test:oracle-browser`).

## 5. Oracle → Oracle

Oracle → Oracle uses its own typed data path (`src-tauri/src/db/transfer_oracle.rs`) instead of the generic text reader and writer:

- Values travel in their native binary form through array DML (`Batch`, 500 rows or 16 MiB per round trip). `NUMBER` is passed as Oracle's exact decimal text, `BINARY_FLOAT`/`BINARY_DOUBLE` keep NaN, ±Infinity and their extremes, `DATE`, `TIMESTAMP` and `INTERVAL` stay typed, `TIMESTAMP WITH TIME ZONE` keeps its region name (`TZR`), `BOOLEAN` stays boolean.
- `CLOB`, `NCLOB`, `BLOB`, `LONG` and `LONG RAW` are copied in full without size limits. `XMLTYPE` goes through `XMLSERIALIZE`/`XMLPARSE`, `JSON` through `JSON_SERIALIZE`/`JSON()`.
- User-defined object types, `VARRAY`s and nested tables are rebuilt attribute by attribute as instances of the target schema's types.
- Each table is loaded in one transaction (autocommit off), counted, and committed only when the count matches. The source stays in one `SET TRANSACTION READ ONLY` snapshot for all tables.
- Code objects are created in dependency order; one that only compiles once a later object exists (a view calling a function, a package body using a view) is kept and the target schemas are recompiled once at the end (`DBMS_UTILITY.COMPILE_SCHEMA`). Objects still invalid afterwards are reported as warnings, separately for objects that are invalid in the source as well.
- Plans are rejected when a column has a type whose content cannot be copied faithfully (`BFILE`, `ANYDATA`/`ANYTYPE`/`ANYDATASET`, `VECTOR`, `MLSLABEL`, `REF`).

Structure comes from the catalog as for every native transfer. Oracle → Oracle adds object grants (optional, see section 2), materialized view logs (created after the load, or before it when a fast-refreshable materialized view needs them), nested table storage clauses, invisible and virtual columns, deferrable and `NOVALIDATE`/`DISABLE` constraint states and disabled triggers. Materialized views are rebuilt by `BUILD IMMEDIATE` and not loaded row by row. Internal objects (nested table storage, `MLOG$_` tables, system constraints on hidden columns) are recreated by Oracle and skipped.

**Overwrite ("Ziel vollständig überschreiben").** Off by default. When on, the plan lists every object of the target schemas that will be dropped, and the start button asks for the target schema name to be typed. The run then empties the target schemas (repeated drop passes until nothing droppable is left: tables with `CASCADE CONSTRAINTS PURGE`, types with `FORCE`, scheduler objects through `DBMS_SCHEDULER`), checks that the schema really is empty and only then creates and loads. Objects that cannot be dropped are reported as warnings. Only the confirmed list is dropped: if objects appeared in the target after planning, the run stops before deleting anything and asks for a new plan. Overwrite is refused for Oracle-maintained schemas (`ORACLE_MAINTAINED = 'Y'`), when objects of other schemas depend on the target (foreign keys into it, columns or types using its types), since dropping would change those schemas too (read from the `DBA_` views; without access to them the `ALL_` views only show dependents the target user can see), and when source and target are the same database (same `CON_DBID` and `DB_UNIQUE_NAME`) and a target schema is also a source schema, so a source can never be deleted by mistake. Oracle DDL cannot be rolled back, so overwriting keeps the previous content aside until the run has succeeded (see "Overwrite backup" below). Without overwrite, a failed run still removes exactly what it created.

**Overwrite backup (Oracle, MySQL, ClickHouse).** Targets without transactional DDL never drop the objects they overwrite before the new content is complete (`src-tauri/src/db/transfer_backup.rs`). Applies to "Alles" and "Nur Struktur" with overwrite, for whole schemas and table selections:

- **Tables are renamed, not dropped.** Each table gets a backup name `L8B$<run>$<n>`; its rows, indexes, grants and identity sequences stay untouched. Oracle also renames user-named constraints and indexes of those tables (their names are schema-wide and would collide with the new objects) and drops materialized view logs first, because a master table with a log cannot be renamed. MySQL drops user-named foreign keys and check constraints and the triggers of those tables for the same reason. ClickHouse renames tables and views.
- **Everything else is saved as DDL and dropped:** Oracle views, materialized views, sequences (with their current value), synonyms, functions, procedures, packages, types, triggers, materialized view logs and the object grants on them; MySQL views, functions, procedures, triggers, foreign keys and check constraints. The DDL comes from the schema catalog. Before anything changes, the complete restore script is written to `transfer-sicherung-<run>.sql` in the log directory.
- **On error or cancellation** the run stops at the first failure, drops what it created, renames everything back and replays the saved DDL (repeated passes resolve dependencies; Oracle re-enables function-based indexes and recompiles the schema, MySQL re-adds foreign keys with `FOREIGN_KEY_CHECKS = 0`). The outcome reports `secured` and `rolledBack`; the UI shows "Der alte Zielstand wurde wiederhergestellt."
- **On success** the backup tables are dropped and the script is deleted. Objects named `L8B$…` are never listed as overwritable, so a backup left by a failed restore survives later runs until it is removed by hand. A backup that cannot be dropped is reported as a warning with its name.
- **If restoring fails** (for example the connection is gone), nothing of the backup is deleted. The outcome lists every step that failed, the backup names with their original names, and the path of the restore script.
- **If the backup itself fails** (a table cannot be renamed, a definition cannot be read), the steps done so far are undone and the run aborts before creating anything.
- **No backup is possible** when the overwritten objects include Oracle clusters, dimensions, operators, index types, libraries, scheduler objects or indexes on foreign tables, an Oracle table column that uses an overwritten object type (dropping the type would destroy the column), an overwritten Oracle table with a nested table (its storage table name would collide), any ClickHouse materialized view, live view, dictionary or `Replicated*` table, or when the target is MariaDB (not tested). The plan then carries a warning and `secured = false` (a run whose plan promised a backup that is no longer possible aborts before changing anything), and the run behaves as before: a failing statement or table is skipped, the run continues, and the outcome (`kept`) lists every failed step while everything else stays in the target.
- "Nur Daten" with overwrite deletes rows instead of objects and has no backup; a failure keeps what was loaded (`kept`).
- Space: old and new content exist side by side until the run ends.

Known gaps: Oracle grants issued by someone other than the schema owner, MySQL routine privileges and the definer of MySQL views, routines and triggers (recreated as the connecting user) are not restored; restored materialized views are rebuilt from their query; an Oracle `LOB` segment with a user-chosen name collides with the new table and makes the run fail (the old state is then restored). If the app dies mid-run, the backup tables and the script remain and have to be applied by hand.

**DuckDB** drops and recreates inside its single target transaction, so a failed structure overwrite rolls back to the previous content. Only "Nur Daten" with overwrite still commits the emptied tables before loading, because DuckDB cannot delete parent and child rows of a foreign key in one transaction.

Limits: object attributes of type `NUMBER` inside user-defined types pass through the driver's number conversion; nested table elements are copied in order without gaps (deleted element positions are compacted). Database links, scheduler jobs, users, roles and tablespaces are not transferred.

