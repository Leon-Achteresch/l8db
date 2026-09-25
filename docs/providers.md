# Database providers

The registry in [provider.rs](../src-tauri/src/db/provider.rs) defines products, protocol families, driver availability and feature flags. A product entry selects a family adapter; it is not a guarantee of complete compatibility with every hosted service. PostgreSQL wire-compatible products can have different catalogs, SQL and permissions.

## Products and drivers

| Product | Family | Required driver |
| --- | --- | --- |
| PostgreSQL | Postgres | builtin |
| Supabase | Postgres | builtin |
| Neon | Postgres | builtin |
| CockroachDB | Postgres | builtin |
| Amazon Redshift | Postgres | builtin |
| TimescaleDB | Postgres | builtin |
| YugabyteDB | Postgres | builtin |
| AlloyDB | Postgres | builtin |
| Materialize | Postgres | builtin |
| CrateDB | Postgres | builtin |
| QuestDB | Postgres | builtin |
| Greenplum | Postgres | builtin |
| Cloud Postgres | Postgres | builtin |
| MySQL | Mysql | builtin |
| MariaDB | Mysql | builtin |
| TiDB | Mysql | builtin |
| PlanetScale | Mysql | builtin |
| SingleStore | Mysql | builtin |
| Aurora MySQL | Mysql | builtin |
| Vitess | Mysql | builtin |
| Apache Doris | Mysql | builtin |
| OceanBase | Mysql | builtin |
| SQLite | Sqlite | builtin |
| libSQL / Turso (lokal) | Sqlite | builtin |
| DuckDB | Duckdb | Cargo feature `duckdb` |
| SQL Server | Mssql | builtin |
| Azure SQL | Mssql | builtin |
| ClickHouse | Clickhouse | builtin |
| MongoDB | Mongodb | builtin |
| MongoDB Atlas | Mongodb | builtin |
| Amazon DocumentDB | Mongodb | builtin |
| Azure Cosmos DB (Mongo) | Mongodb | builtin |
| FerretDB | Mongodb | builtin |
| Redis | Redis | builtin |
| Valkey | Redis | builtin |
| KeyDB | Redis | builtin |
| Dragonfly | Redis | builtin |
| Oracle Database | Oracle | Oracle Instant Client |
| Apache Cassandra | Cassandra | builtin |
| ScyllaDB | Cassandra | builtin |
| ODBC (generisch) | Odbc | installed ODBC driver |
| IBM Db2 | Odbc | IBM DB2 ODBC DRIVER |
| Firebird | Odbc | Firebird/InterBase(r) driver |
| IBM Informix | Odbc | IBM INFORMIX ODBC DRIVER |
| SAP ASE (Sybase) | Odbc | Adaptive Server Enterprise |
| SAP HANA | Odbc | HDBODBC |
| Teradata | Odbc | Teradata Database ODBC Driver |
| Snowflake | Odbc | SnowflakeDSIIDriver |
| Google BigQuery | Odbc | Simba ODBC Driver for Google BigQuery |
| Databricks | Odbc | Simba Spark ODBC Driver |
| Amazon Athena | Odbc | Simba Athena ODBC Driver |
| Vertica | Odbc | Vertica |
| Exasol | Odbc | EXASOL Driver |
| Trino / Presto | Odbc | Trino ODBC Driver |
| Apache Hive / Impala | Odbc | Cloudera ODBC Driver for Apache Hive |
| IBM Netezza | Odbc | NetezzaSQL |
| Microsoft Access | Odbc | Microsoft Access Driver (*.mdb, *.accdb) |

## Feature scope

All adapters implement connection testing, database/schema/table/column discovery, row reads, counts and queries. Results depend on server permissions and product compatibility.

| Family | Additional registry capabilities |
| --- | --- |
| Postgres | Row editing, transactions, table transactions, DDL, explain, catalog administration, CSV import, full export, data comparison, schema snapshots, migration scripts, cancellation, debugger |
| Mysql | Row editing, transactions, table transactions, SQL catalog objects, DDL, explain, sessions, schema and data comparison |
| Sqlite | Row editing, transactions, views, indexes, constraints, DDL, explain, cancellation, schema and data comparison; no SSH/TLS or stored functions |
| Mssql | Row editing, transactions, table transactions, SQL catalog objects, DDL, explain, sessions, sequences, proxy user, schema and data comparison |
| Oracle | Row editing, transactions, table transactions, SQL catalog objects, DDL, PL/SQL debugger, compilation, server output, object grants and administration, explain (PLAN_TABLE; ANALYZE needs V$SESSION and V$SQL_PLAN_STATISTICS_ALL) |
| Duckdb | SQL catalog objects, DDL, explain; no row editing or transaction UI |
| Clickhouse | Views, functions, DDL, column changes, explain and overview |
| Mongodb | JSON queries and filters, collections, indexes and DDL |
| Redis | Redis commands and key-pattern filtering |
| Cassandra | CQL, keyspaces, indexes, DDL and column changes |
| Odbc | Queries, views and DDL; other capabilities remain disabled |

The exact flags are `DatabaseKind::capabilities()`. Product compatibility and driver availability are separate from those flags. Use the app's driver status and provider hints when connecting.

## Optional builds

Standard builds omit DuckDB and ODBC. Enable them with `bun run tauri build -- --features duckdb`, `--features odbc`, or `--features duckdb,odbc`. DuckDB is bundled when enabled. ODBC additionally needs a platform driver manager and the vendor driver from the table above, matching the app architecture. Oracle loads Oracle Instant Client at runtime; install it for the app's architecture. A provider entry can remain visible even when its driver is unavailable.

## Adding a product or family

1. For an existing protocol, add a product to `PROVIDERS` with its detection hosts, connection hint and driver requirements. Do not create another adapter for a brand using the same protocol.
2. For a new family, extend `DatabaseKind`, URL schemes, capabilities, driver status and `create_adapter_from_string` in [mod.rs](../src-tauri/src/db/mod.rs). Implement the required `DatabaseAdapter` methods in one adapter file. Enable optional operations only when implemented; the trait defaults reject unsupported operations.
3. Mirror serialized Rust types in [the TypeScript bridge](../src/lib/db/index.ts), especially [provider types](../src/lib/db/providers.ts). Keep invocations centralized in that bridge. Update URL detection through the registry and gate UI with capabilities.
4. Preserve effective SSH URLs, secret handling, read-only protection and validated filters. A failed tunnel must never fall back to a direct connection.
5. Add registry/URL/bridge regressions and adapter tests. Run `bun run test`, `bun run check`, `bun run build`, `cargo check --locked`, `cargo clippy --all-targets --locked`, and `cargo test --locked` in their respective directories. Test optional builds separately when affected.

`smoke_adapters_from_env` is ignored by default and runs configured `L8DB_SMOKE_<KIND>_URL` providers. It is not the mandatory integration suite. The isolated PostgreSQL/SSH suite is described in [integration-tests.md](integration-tests.md).
