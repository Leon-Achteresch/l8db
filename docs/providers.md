# Database providers

The registry in [provider.rs](../src-tauri/src/db/provider.rs) defines products, protocol families, driver availability and feature flags. A product entry selects a family adapter; it is not a guarantee of complete compatibility with every hosted service. PostgreSQL wire-compatible products can have different catalogs, SQL and permissions.

## Supabase BaaS

The **BaaS** navigation area connects to Supabase independently of the PostgreSQL connection. Create a [personal access token](https://supabase.com/dashboard/account/tokens) with read access to Projects, Project Settings, Storage and Edge Functions. l8db verifies the project list before saving the token in the OS keychain. The project view shows service health, buckets and Edge Functions; individual permission errors do not hide the other resources. A matching PostgreSQL connection can be opened from that view.

Bucket file listings and Auth users require a project Secret API Key. The project view can import an existing key through `GET /v1/projects/{ref}/api-keys?reveal=true` when the Management API token has API Keys Read and API Key Secrets Read permissions. It chooses a modern `default` secret key, the only modern secret key, or a legacy `service_role` key in that order. With multiple non-default secret keys, enter the intended key manually. Publishable and `anon` keys are rejected. The key is verified and stored in the OS keychain; its value never returns to the frontend during import. The Management API token does not authenticate project Storage or Auth requests. The Rust backend sends modern `sb_secret_` keys only in the `apikey` header; legacy `service_role` JWTs also use the bearer header. The project view is currently read-only; use the PostgreSQL workspace for SQL operations. Disconnecting removes the Management API token and the saved project keys.

Relevant Supabase documentation: [Management API](https://supabase.com/docs/reference/api/introduction), [project API keys](https://supabase.com/docs/reference/api/v1-get-project-api-keys), [personal access tokens](https://supabase.com/docs/guides/platform/personal-access-tokens), [API key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), [Storage access](https://supabase.com/docs/guides/storage/security/access-control), and [Auth admin users](https://supabase.com/docs/reference/javascript/auth-admin-listusers).

## Appwrite BaaS

The **Appwrite** tab in BaaS connects one project at a time using its API endpoint (`https://<region>.cloud.appwrite.io/v1` for Appwrite Cloud), project ID and [project API key](https://appwrite.io/docs/partners/project/api-keys). Because keys are project-scoped, add each project separately. l8db verifies the key with `GET /project` before saving it in the OS keychain; the form clears the key after connection and never persists it in localStorage. HTTPS is required, except for localhost development endpoints. Redirects are not followed when sending the key.

The project view lists Storage buckets and files, TablesDB databases, tables, columns and rows, Functions, Auth users and Sites. Each section reports its own permission error so other sections remain usable. Give the key `project.read` and the relevant read scopes for the sections you want to inspect (`buckets.read`, `files.read`, `databases.read`, `tables.read`, `columns.read`, `rows.read`, `functions.read`, `users.read`, `sites.read`). Lists are paginated in batches of 100. The current Appwrite view is read-only and uses the current TablesDB endpoints, not the legacy DocumentsDB collection API. Disconnecting removes that project's key and profile.

Relevant Appwrite documentation: [REST API and query format](https://appwrite.io/docs/apis/rest), [project endpoint](https://appwrite.io/docs/references/cloud/server-rest/project), [Storage API](https://appwrite.io/docs/references/cloud/server-rest/storage), and [TablesDB API](https://appwrite.io/docs/references/cloud/server-swift/tablesDB).

## PocketBase BaaS

The **PocketBase** tab connects a PocketBase instance by its base URL and a [superuser impersonation token](https://pocketbase.io/docs/authentication/#api-keys). PocketBase requires superuser access to list collection definitions. This token has full administrative privileges on the instance; l8db uses it only for read requests, verifies it through `GET /api/settings`, and stores it in the OS keychain. HTTPS is required except on loopback hosts, and redirects are not followed when sending the token.

The view lists non-system collections, their fields, paginated records, Auth collections and file fields attached to records. PocketBase stores files on records rather than in separate buckets, so filenames appear beneath their records. Hidden fields and system collections are excluded from the response sent to the frontend. The project card opens the PocketBase dashboard on the instance. Disconnecting removes the token and profile. The current view is read-only.

The ignored Rust test `live_lab_reads_collection_records_and_protected_file` checks the HTTP readers against a running PocketBase instance without changing saved profiles. Provide `L8DB_E2E_POCKETBASE_URL`, `L8DB_E2E_POCKETBASE_TOKEN`, `L8DB_E2E_POCKETBASE_COLLECTION_ID`, `L8DB_E2E_POCKETBASE_RECORD_ID`, and `L8DB_E2E_POCKETBASE_FILENAME`, then run `cargo test --lib pocketbase::tests::live_lab_reads_collection_records_and_protected_file -- --ignored --test-threads=1` in `src-tauri/`. Use a non-system collection with a record containing the named file; a protected file exercises the short-lived file-token flow.

Supabase, Appwrite and PocketBase files can be opened from their resource lists. l8db previews raster images and UTF-8 text or JSON. Preview requests stop at 4 MB, including when the remote service omits `Content-Length`. The native save dialog downloads files of any size directly through the Rust backend into a temporary file, then moves it to the chosen destination after success. Provider credentials do not reach the WebView.

Relevant PocketBase documentation: [collections API](https://pocketbase.io/docs/api-collections/), [records API](https://pocketbase.io/docs/api-records/), [files API](https://pocketbase.io/docs/api-files/), and [dashboard route](https://pocketbase.io/docs/).

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
| libSQL / Turso (remote) | SqliteHttp | builtin (HTTP) |
| Cloudflare D1 | SqliteHttp | builtin (HTTP) |
| DuckDB | Duckdb | builtin (Cargo feature `duckdb`, default) |
| SQL Server | Mssql | builtin |
| Azure SQL | Mssql | builtin |
| ClickHouse | Clickhouse | builtin |
| InfluxDB | Influxdb | builtin (HTTP) |
| Elasticsearch | Elasticsearch | builtin (HTTP) |
| OpenSearch | Elasticsearch | builtin (HTTP) |
| Google BigQuery | Bigquery | builtin (REST API v2) |
| Snowflake | Snowflake | builtin (SQL API v2) |
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
| Amazon DynamoDB | Dynamodb | builtin |
| DynamoDB Local / LocalStack | Dynamodb | builtin |
| Amazon Athena | Athena | builtin |
| MinIO | S3 | builtin |
| Amazon S3 | S3 | builtin |
| Cloudflare R2 | S3 | builtin |
| Google Cloud Storage (S3) | S3 | builtin |
| Backblaze B2 | S3 | builtin |
| DigitalOcean Spaces | S3 | builtin |
| S3-kompatibel | S3 | builtin |
| ODBC (generisch) | Odbc | installed ODBC driver |
| IBM Db2 | Odbc | IBM DB2 ODBC DRIVER |
| Firebird | Odbc | Firebird/InterBase(r) driver |
| IBM Informix | Odbc | IBM INFORMIX ODBC DRIVER |
| SAP ASE (Sybase) | Odbc | Adaptive Server Enterprise |
| SAP HANA | Odbc | HDBODBC |
| Teradata | Odbc | Teradata Database ODBC Driver |
| Snowflake (ODBC) | Odbc | SnowflakeDSIIDriver |
| Google BigQuery (ODBC) | Odbc | Simba ODBC Driver for Google BigQuery |
| Databricks | Odbc | Simba Spark ODBC Driver |
| Amazon Athena (ODBC) | Odbc | Simba Athena ODBC Driver |
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
| SqliteHttp | Row editing via SQL, views, indexes, foreign keys, triggers, DDL, explain; every statement commits immediately, so rollback is rejected |
| Elasticsearch | Indices, data streams and aliases as tables, mapping fields as columns, SQL, Dev-Tools requests, Lucene/Query-DSL filters, drop/truncate index; no row editing |
| Influxdb | Buckets/databases, measurements, tags and fields; SQL (v3), Flux (v2), InfluxQL and line-protocol writes |
| Dynamodb | PartiQL queries and filters, key/GSI/LSI indexes, row editing staged in a transaction; no DDL, SSH or TLS options |
| Athena | Trino SQL, catalogs as databases, partition keys, cancellation via StopQueryExecution, scan/cost notices in server output |
| Bigquery | Datasets as schemas, views, dry-run explain with byte estimate, job-based cancellation |
| Snowflake | Databases, schemas, views, role quick switch (proxy user), text explain, statement cancellation |
| S3 | Object storage (`object_storage`): bucket browser instead of tables, uploads/downloads, bucket and object configuration, S3 Select; read-only mode supported |

The exact flags are `DatabaseKind::capabilities()`. Product compatibility and driver availability are separate from those flags. Use the app's driver status and provider hints when connecting.

## AWS providers

DynamoDB and Athena talk to the AWS JSON APIs directly (hand-written SigV4 over `reqwest`, see [aws.rs](../src-tauri/src/db/aws.rs)); no AWS SDK is linked. URL layout:

```
dynamodb://ACCESS_KEY:SECRET[:SESSION_TOKEN]@REGION[?endpoint=http://localhost:8000]
dynamodb://REGION?profile=NAME
athena://REGION/CATALOG?workgroup=primary&output=s3://bucket/prefix/&schema=default
```

- Host is the region; `auto` resolves it from `AWS_REGION`, `AWS_DEFAULT_REGION` or the profile's `region`.
- Credentials: user/password are the access key and secret (the session token is appended to the secret as `secret:token`, so the whole secret lives in the OS keychain). `?profile=` reads `~/.aws/credentials` and `~/.aws/config` (static keys, `credential_process`, AWS SSO via the `aws sso login` token cache). Without either, environment variables and then `AWS_PROFILE`/`default` are used. `role_arn`/`source_profile` (AssumeRole) are not supported; use `credential_process` or SSO. Apps started from Finder do not see shell environment variables.
- `?endpoint=` overrides the service endpoint (DynamoDB Local, LocalStack, VPC endpoints).
- DynamoDB: tables are listed per region, columns are the key schema plus attributes sampled from 100 items. Browsing uses `Scan` (filters use PartiQL `ExecuteStatement`) with a cursor cache for paging; sorting is not applied. Counts use `Scan` with `Select=COUNT` and fall back to the approximate `ItemCount` above the cap. Row edits are staged and committed together with `ExecuteTransaction` (max. 100 changes, one change per item); key attributes cannot be changed.
- Athena: `ListDataCatalogs` feed the database picker, Athena databases are schemas. Queries poll `GetQueryExecution`; cancel and query timeout call `StopQueryExecution`. With server output enabled every query reports scanned bytes and an estimated cost (5 USD/TB, 10 MB minimum). The ODBC entry remains available as "Amazon Athena (ODBC)".
- Tests: `cargo test --lib -- db::aws db::dynamodb db::athena` covers SigV4 test vectors and a mocked Athena API. `dynamodb_local_end_to_end` (ignored) needs `amazon/dynamodb-local` on `127.0.0.1:18000` or `L8DB_E2E_DYNAMODB_URL`. The smoke test uses `L8DB_SMOKE_DYNAMODB_URL` / `L8DB_SMOKE_ATHENA_URL` (DynamoDB queries its first table).

## Object storage (S3)

The `s3` family covers Amazon S3 and every S3-compatible service. It speaks the S3 REST API directly (SigV4 on `reqwest`, credentials shared with [aws.rs](../src-tauri/src/db/aws.rs)); code lives in [db/s3](../src-tauri/src/db/s3/).

```
s3://ACCESS_KEY:SECRET@REGION/OPTIONAL_BUCKET?endpoint=https%3A%2F%2Fs3.example.com&path_style=true
s3://eu-central-1?profile=default
```

- Host is the region. Without credentials in the URL, the AWS environment/profile chain is used. `endpoint` switches to a custom service and defaults to path-style addressing; a path segment pins the connection to one bucket (useful when `ListBuckets` is denied). The provider label is derived from the endpoint host (R2, B2, Spaces, GCS, `:9000`/`minio` → MinIO, otherwise S3-kompatibel).
- Buckets replace tables: the sidebar lists buckets and opens a bucket tab (`/buckets/$bucket`) with object browser, bucket settings and incomplete multipart uploads. The generic `DatabaseAdapter` maps buckets to tables so the SQL editor, MCP and smoke test work too.
- Object browser: prefix navigation, recursive search, versions view, multi-select, preview (image, CSV, JSON, text, hex), text editing (keeps metadata and tags), upload/download of files and folders (8 MiB multipart parts, progress in the task panel, cancellable, drag & drop into the active bucket), rename, server-side copy/move, delete (optionally all versions, governance bypass), metadata and properties, tags, restore versions, retention and legal hold, presigned GET/PUT URLs, S3 Select.
- Bucket settings: statistics, versioning, default encryption, object lock defaults, tags, policy (with presets), lifecycle rules, CORS, notifications, replication, static website, ACL and location. Features a server does not implement are reported as unsupported.
- SQL editor: `SHOW BUCKETS`, `LIST s3://bucket/prefix/` and `SELECT … FROM s3://bucket/key.csv` (S3 Select for CSV/TSV, JSON, JSON lines and Parquet, optionally gzip/bzip2).
- Lab: `scripts/minio-lab.sh` starts MinIO from `tests/lab/minio/compose.yml` (API `127.0.0.1:9000`, console `:9001`, `l8dbadmin`/`l8dbsecret`) and seeds the buckets `demo`, `versioned` and `locked`; `scripts/minio-lab.sh down` removes it. Connection URL: `s3://l8dbadmin:l8dbsecret@us-east-1?endpoint=http%3A%2F%2F127.0.0.1%3A9000`.
- Tests: `cargo test --lib db::s3` (SigV4 vectors, XML, event stream, path safety) and `bun test tests/s3-storage.test.ts tests/s3-provider-detection.test.ts`. The ignored `s3_live_*` tests run against the lab or `L8DB_E2E_S3_URL`: `cargo test --lib s3_live -- --ignored --test-threads=1`. The smoke test uses `L8DB_SMOKE_S3_URL`.

## Cloud warehouses

BigQuery and Snowflake talk HTTPS to the vendor APIs; SSH tunnels and the SSL selector do not apply. Secrets (service-account JSON, access tokens, private keys) occupy the password slot of the URL and therefore live in the OS keychain like every other password. The ODBC entries stay available as alternates.

**BigQuery** (`bigquery.rs`): `bigquery://[auth[:secret]@]project[/default_dataset]?location=EU&endpoint=…&credentials_file=…`

- `auth` empty or `adc`: Application Default Credentials from `GOOGLE_APPLICATION_CREDENTIALS`, otherwise `application_default_credentials.json` in the gcloud config directory (`CLOUDSDK_CONFIG`, `~/.config/gcloud`, `%APPDATA%\gcloud`). Both `service_account` and `authorized_user` (refresh token from `gcloud auth application-default login`) files work; `quota_project_id` becomes `x-goog-user-project`.
- `service_account`: key JSON as secret or `credentials_file`; signed as an RS256 JWT and exchanged at `token_uri`.
- `token`: a ready OAuth access token. `none`: no authorization header (emulator).
- `endpoint` overrides `https://bigquery.googleapis.com`, e.g. for `ghcr.io/goccy/bigquery-emulator`.
- Datasets are schemas, `tables.list` separates tables and views, columns come from `tables.get` (records flattened as `a.b`, repeated fields as JSON). Unfiltered table reads use the free `tabledata.list`, counts use `numRows`; filters, sorting and views fall back to a query. Queries use `jobs.query` plus `jobs.getQueryResults` paging; cancellation calls `jobs.cancel`. Explain runs a dry run and reports the processed bytes; explain analyze runs the job and maps its query-plan stages.
- Types: INT64 as numbers within ±2^53, NUMERIC/BIGNUMERIC as strings, TIMESTAMP as `YYYY-MM-DD HH:MM:SS[.ffffff] UTC`, BYTES as `\x…` hex, JSON parsed, GEOGRAPHY as WKT.

**Snowflake** (`snowflake.rs`): `snowflake://user[:secret]@account/DATABASE?schema=…&warehouse=…&role=…&authenticator=…&private_key_file=…`

- `authenticator=snowflake_jwt` (default when the secret is a PEM key or `private_key_file` is set): PKCS#8, PKCS#1 or encrypted PKCS#8 (AES/3DES, PBKDF2) keys; the passphrase follows the PEM block in the secret or is the secret when `private_key_file` is used. The JWT uses `ACCOUNT.USER.SHA256:<fingerprint>`.
- `programmatic_access_token` (default otherwise) and `oauth` send the secret as bearer token.
- Statements run asynchronously with polling, result partitions are paged (gzip-aware), multi-statement scripts set `MULTI_STATEMENT_COUNT` and return the last result. Cancellation calls the statement cancel endpoint. The catalog uses `SHOW` commands so browsing works without a running warehouse; row reads and filtered counts need one.
- The workspace header's proxy-user switch lists `SHOW ROLES` and sends the choice as `proxy_user`, which overrides `role`. The warehouse is chosen in the connection editor.
- Types: FIXED with scale 0 as numbers within ±2^53 (otherwise strings), DATE/TIME/TIMESTAMP_NTZ/LTZ/TZ converted from epoch values, VARIANT/OBJECT/ARRAY parsed as JSON, BINARY as `\x…` hex.

Tests: the adapters are covered by mocked HTTP tests (`cargo test bigquery snowflake warehouse_auth`). `emulator_end_to_end` is ignored and runs against the BigQuery emulator when `L8DB_E2E_BIGQUERY_URL` is set, e.g. `bigquery://test?endpoint=http%3A%2F%2F127.0.0.1%3A9050&auth=none` with a `dataset1.table_a` fixture. Snowflake has no emulator; only the mocked tests exist.

## Default and optional builds

Standard builds include DuckDB and ODBC (Cargo default features `duckdb` and `odbc`). DuckDB is compiled from the bundled sources. ODBC uses odbc-api's `vendored-unix-odbc`: the unixODBC driver manager is compiled from source and linked statically on macOS and Linux, so the binary has no dynamic dependency on `libodbc` and starts on machines without unixODBC (`otool -L` / `ldd` show no ODBC library). Windows links the system `odbc32.dll`, which is always present. Only the vendor driver from the table above is still needed, registered in `odbcinst.ini` and matching the app architecture. The static driver manager reads `/etc/odbcinst.ini`; on macOS l8db sets `ODBCSYSINI` to `/opt/homebrew/etc`, `/usr/local/etc` or `/Library/ODBC` when `/etc/odbcinst.ini` is missing and `ODBCSYSINI`/`ODBCINSTINI` are not set. The vendored unixODBC is LGPL-2.1.

`bun run tauri build -- --no-default-features` builds without both; add `--features duckdb` or `--features odbc` to re-enable one. Oracle loads Oracle Instant Client at runtime; install it for the app's architecture. A provider entry can remain visible even when its driver is unavailable.

DuckDB also opens CSV and Parquet files: a DuckDB connection whose path ends in `.csv` or `.parquet` opens an in-memory database with a view named after the file (`read_csv_auto` / `read_parquet`).

## Adding a product or family

1. For an existing protocol, add a product to `PROVIDERS` with its detection hosts, connection hint and driver requirements. Do not create another adapter for a brand using the same protocol.
2. For a new family, extend `DatabaseKind`, URL schemes, capabilities, driver status and `create_adapter_from_string` in [mod.rs](../src-tauri/src/db/mod.rs). Implement the required `DatabaseAdapter` methods in one adapter file. Enable optional operations only when implemented; the trait defaults reject unsupported operations.
3. Mirror serialized Rust types in [the TypeScript bridge](../src/lib/db/index.ts), especially [provider types](../src/lib/db/providers.ts). Keep invocations centralized in that bridge. Update URL detection through the registry and gate UI with capabilities.
4. Preserve effective SSH URLs, secret handling, read-only protection and validated filters. A failed tunnel must never fall back to a direct connection.
5. Add registry/URL/bridge regressions and adapter tests. Run `bun run test`, `bun run check`, `bun run build`, `cargo check --locked`, `cargo clippy --all-targets --locked`, and `cargo test --locked` in their respective directories. Test optional builds separately when affected.

## HTTP families

| Family | URL | Notes |
| --- | --- | --- |
| Elasticsearch | `elasticsearch://user:pw@host:9200`, `opensearch://host:9200`, `https://…` for known cloud hosts | API key via user `apikey` or `?api_key=` (`id:key` or encoded); `?tls=true`, `?insecure=true`; the flavor is detected via `GET /`. Filters take builder SQL, Lucene or Query-DSL JSON. Offsets beyond 10 000 use PIT + `search_after` (Elasticsearch) or scroll (OpenSearch). Queries accept SQL or `GET index/_search {…}`. |
| Influxdb | `influxdb://token:TOKEN@host:8086/bucket?org=acme` | `?version=2\|3` forces the API, otherwise `/ping` decides. Table views show the last hour; change with `?range=15m`, `7d` or `all`. Queries accept SQL (v3), Flux (v2), InfluxQL and line protocol. |
| SqliteHttp | `libsql://[token:TOKEN@]host[?authToken=…&tls=false]`, `d1://ACCOUNT_ID:API_TOKEN@api.cloudflare.com/<database name or uuid>` | libSQL uses the Hrana `/v2/pipeline`; D1 uses the Cloudflare `/raw` query API. |

Generic `http(s)://` URLs remain ClickHouse unless the host matches a known Elastic, InfluxData or AWS OpenSearch domain. InfluxDB 1.x is not supported.

Live checks (ignored): `L8DB_SMOKE_ELASTICSEARCH_URL`, `L8DB_E2E_OPENSEARCH_URL`, `L8DB_SMOKE_INFLUXDB_URL` (v2), `L8DB_E2E_INFLUXDB3_URL` and `L8DB_SMOKE_SQLITEHTTP_URL` drive `http_live_tests`; they expect the seeded indices `logs`/`big`, measurements `cpu`/`mem` and a writable libSQL server. D1 is covered by a mocked HTTP server in the unit tests.

`smoke_adapters_from_env` is ignored by default and runs configured `L8DB_SMOKE_<KIND>_URL` providers. It is not the mandatory integration suite. The isolated PostgreSQL/SSH suite is described in [integration-tests.md](integration-tests.md).
