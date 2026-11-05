# Database providers

The registry in [provider.rs](../src-tauri/src/db/provider.rs) defines products, protocol families, driver availability and feature flags. A product entry selects a family adapter; it is not a guarantee of complete compatibility with every hosted service. PostgreSQL wire-compatible products can have different catalogs, SQL and permissions.

## Supabase BaaS

The **BaaS** navigation area connects to Supabase independently of the PostgreSQL connection. Create a [personal access token](https://supabase.com/dashboard/account/tokens) with read access to Projects, Project Settings, Storage and Edge Functions. Database Read adds an in-project table, column and row preview through the Management API with `read_only: true`; queries are constructed by the Rust backend and capped to 100 tables or 50 rows per page. Backups Read adds the database backup list, statuses and PITR window. l8db verifies the project list before saving the token in the OS keychain. The project view shows service health, buckets and Edge Functions; individual permission errors do not hide the other resources. A matching PostgreSQL connection can be opened from that view.

Bucket file listings, bucket limits and Auth users require a project Secret API Key. The project view can import an existing key through `GET /v1/projects/{ref}/api-keys?reveal=true` when the Management API token has API Keys Read and API Key Secrets Read permissions. It chooses a modern `default` secret key, the only modern secret key, or a legacy `service_role` key in that order. With multiple non-default secret keys, enter the intended key manually. Publishable and `anon` keys are rejected. The key is verified and stored in the OS keychain; its value never returns to the frontend during import. The Management API token does not authenticate project Storage or Auth requests. The Rust backend sends modern `sb_secret_` keys only in the `apikey` header; legacy `service_role` JWTs also use the bearer header. Storage displays each selected bucket's access, type, size and MIME restrictions through the project Storage API and uses the bucket ID for file operations. File details show paths, IDs, sizes, MIME types and timestamps from the Storage list response. Uploads use a native file picker, stream file bytes from Rust and do not overwrite existing objects. Storage files can be renamed or deleted after confirmation. Edge Function details include JWT verification and source paths when supplied by the API. Auth user details show contact verification, account type and sign-in dates. Database view remains read-only; use the PostgreSQL workspace for SQL operations. Disconnecting removes the Management API token and the saved project keys.

Relevant Supabase documentation: [Management API](https://supabase.com/docs/reference/api/introduction), [database query](https://supabase.com/docs/reference/api/v1-run-a-query), [database backups](https://supabase.com/docs/reference/api/v1-list-all-backups), [backup scope](https://supabase.com/docs/guides/platform/backups), [Edge Functions](https://supabase.com/docs/reference/api/v1-list-all-functions), [project API keys](https://supabase.com/docs/reference/api/v1-get-project-api-keys), [personal access tokens](https://supabase.com/docs/guides/platform/personal-access-tokens), [API key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), [Storage API](https://supabase.com/docs/reference/self-hosting-storage), [Storage uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [Storage access](https://supabase.com/docs/guides/storage/security/access-control), [Auth users](https://supabase.com/docs/guides/auth/users), and [Auth admin users](https://supabase.com/docs/reference/javascript/auth-admin-listusers).

Supabase Storage buckets can be created, switched between public and private access, and deleted when empty. These actions require the project's Secret API Key and use the [Storage API](https://supabase.com/docs/reference/self-hosting-storage).
Auth users can be created with an email and password, have their email changed, and be deleted with confirmation through the [Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-createuser). Edge Functions can be deleted with confirmation through the [Management API](https://supabase.com/docs/reference/api/v1-delete-a-function).

Self-hosted Supabase ([Docker setup](https://supabase.com/docs/guides/self-hosting/docker)) connects with the API gateway URL (`SUPABASE_PUBLIC_URL`, origin only) and the `SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`; l8db checks the key against `/storage/v1/bucket` before storing it in the OS keychain. Each instance gets a `self-<hash>` reference. Storage and Auth use the same project APIs as the cloud; the table preview uses pg-meta (`/pg/query`, service role only), and service health probes Auth, pg-meta, Realtime, PostgREST and Storage. Edge Functions, backups and key import need the Management API and are hidden. The database dialog prefills the Supavisor pooler (`postgres.your-tenant-id`, port 5432, `sslmode=prefer`) and lets host, port and user be changed. Removing a self-hosted instance leaves the cloud token alone and vice versa.

## Appwrite BaaS

The **Appwrite** tab in BaaS connects one project at a time using its API endpoint (`https://<region>.cloud.appwrite.io/v1` for Appwrite Cloud), project ID and [project API key](https://appwrite.io/docs/partners/project/api-keys). Because keys are project-scoped, add each project separately. l8db verifies the key with `GET /project` before saving it in the OS keychain; the form clears the key after connection and never persists it in localStorage. HTTPS is required, except for localhost development endpoints. Redirects are not followed when sending the key.

The project view lists Storage buckets and files, TablesDB databases, tables, columns and rows, Functions, Auth users and Sites. Storage shows bucket limits, accepted file extensions, protection settings and permissions; file lists show full virtual paths, MIME type, creation time and size when the API supplies them. Function details show runtime, deployment, schedule, events and execution roles. Site details show framework, deployment and build configuration. Variable values from those APIs are excluded from the data sent to the frontend. Each section reports its own permission error so other sections remain usable. Give the key `project.read` and the relevant read scopes for the sections you want to inspect (`buckets.read`, `files.read`, `databases.read`, `tables.read`, `columns.read`, `rows.read`, `functions.read`, `users.read`, `sites.read`). Lists are paginated in batches of 100. Storage uploads require `files.write`; l8db uses the native file picker and Appwrite's 5 MB multipart chunks. Files can also be renamed or deleted with `files.write`. Uploads set no additional file-level permissions; bucket-level rules still apply. TablesDB and Sites remain read-only and use the current TablesDB endpoints, not the legacy DocumentsDB collection API. Disconnecting removes that project's key and profile.

Relevant Appwrite documentation: [REST API and query format](https://appwrite.io/docs/apis/rest), [project endpoint](https://appwrite.io/docs/references/cloud/server-rest/project), [Storage API](https://appwrite.io/docs/references/cloud/server-rest/storage), [File model](https://appwrite.io/docs/references/cloud/models/file), [Function model](https://appwrite.io/docs/references/cloud/models/function), [Site model](https://appwrite.io/docs/references/cloud/models/site), [upload and download](https://appwrite.io/docs/products/storage/upload-download), and [TablesDB API](https://appwrite.io/docs/references/cloud/server-swift/tablesDB).

Appwrite buckets can be created, renamed, and deleted with `buckets.write`. Auth users can be created, have their email changed, and be deleted with `users.write`. Functions can be deleted with `functions.write`. These destructive actions require confirmation. See the [Storage](https://appwrite.io/docs/references/cloud/server-rest/storage), [Users](https://appwrite.io/docs/references/cloud/server-rest/users), and [Functions](https://appwrite.io/docs/references/cloud/server-rest/functions) APIs.

## Convex BaaS

The **Convex** tab connects a team by its numeric team ID and a Team Access Token from Team Settings. l8db verifies the token through the [Management API](https://docs.convex.dev/management-api/list-projects), keeps it in the OS keychain, and shows paginated projects with their cloud and local deployments. Each project links to its Convex dashboard. Cloud deployments show environment variable names and support setting and deleting their values through the [Deployment API](https://docs.convex.dev/deployment-api/update-environment-variables); existing values never reach the frontend. The integration uses only official Convex APIs. Generic table and file writes are unavailable because Convex exposes those operations through functions defined by each project.

Self-hosted Convex ([self-hosting guide](https://github.com/get-convex/convex-backend/tree/main/self-hosted)) connects with the backend URL (`CONVEX_CLOUD_ORIGIN`, e.g. `http://127.0.0.1:3210`) and an admin key from `./generate_admin_key.sh`. l8db verifies it with `/api/v1/list_environment_variables` and then manages environment variables like a cloud deployment; projects and deployments do not exist there.

Live checks against real self-hosted instances: `cargo test --lib baas_self_hosted_live -- --ignored --test-threads=1` with `L8DB_E2E_SUPABASE_URL`, `L8DB_E2E_SUPABASE_KEY` (optional `L8DB_E2E_SUPABASE_DB_PASSWORD`, `L8DB_E2E_SUPABASE_DB_PORT`), `L8DB_E2E_CONVEX_URL` and `L8DB_E2E_CONVEX_KEY`. With the same variables, `bun run test:baas-browser` drives the UI through Playwright against the real commands.

## PocketBase BaaS

The **PocketBase** tab connects a PocketBase instance by its base URL and a [superuser impersonation token](https://pocketbase.io/docs/authentication/#api-keys). PocketBase requires superuser access to list collection definitions. This token has full administrative privileges on the instance; l8db verifies it through `GET /api/settings` and stores it in the OS keychain. HTTPS is required except on loopback hosts, and redirects are not followed when sending the token.

The view lists non-system collections, their fields, paginated records, Auth collections and file fields attached to records. PocketBase stores files on records rather than in separate buckets, so filenames appear beneath their records. Base collections can be created, renamed and deleted. Auth users can be created with an email and password. Records can be created, edited as JSON, and deleted; visible file fields support upload and deletion. Deletions require confirmation. Hidden fields and system collections are excluded from the response sent to the frontend and from record edits. The project card opens the PocketBase dashboard on the instance. Disconnecting removes the token and profile.

The ignored Rust test `live_lab_reads_collection_records_and_protected_file` checks the HTTP readers against a running PocketBase instance without changing saved profiles. Provide `L8DB_E2E_POCKETBASE_URL`, `L8DB_E2E_POCKETBASE_TOKEN`, `L8DB_E2E_POCKETBASE_COLLECTION_ID`, `L8DB_E2E_POCKETBASE_RECORD_ID`, and `L8DB_E2E_POCKETBASE_FILENAME`, then run `cargo test --lib pocketbase::tests::live_lab_reads_collection_records_and_protected_file -- --ignored --test-threads=1` in `src-tauri/`. Use a non-system collection with a record containing the named file; a protected file exercises the short-lived file-token flow. `bun run test:pocketbase` downloads the PocketBase release binary, seeds such a collection with a hidden field and a protected file in a temporary data directory, and runs the test.

Supabase, Appwrite and PocketBase files can be opened from their resource lists. l8db previews raster images and UTF-8 text or JSON. Preview requests stop at 4 MB, including when the remote service omits `Content-Length`. The native save dialog downloads files of any size directly through the Rust backend into a temporary file, then moves it to the chosen destination after success. Provider credentials do not reach the WebView.

Relevant PocketBase documentation: [collections API](https://pocketbase.io/docs/api-collections/), [records API](https://pocketbase.io/docs/api-records/), [files API](https://pocketbase.io/docs/api-files/), and [dashboard route](https://pocketbase.io/docs/).

## Firebase BaaS

The **Firebase** tab connects a project by selecting its [service account JSON file](https://firebase.google.com/docs/admin/setup). The Rust backend reads the file with a native picker, verifies access through the Firebase Management API, and stores the credential in the OS keychain. The private key and OAuth access token are not returned to the WebView. The JSON must use Google's standard token endpoint; l8db sends the signed assertion only to that endpoint. The service account needs permission to read the Firebase project and `storage.buckets.list` plus `storage.objects.list` and `storage.objects.get` for Cloud Storage. Each resource reports its own permission error.

The project view opens its Firebase console page and shows project identity, Cloud Storage, Firestore, paginated Auth users, Cloud Functions and Hosting sites. Firestore lists databases, collections, documents and nested collections with page tokens; document fields are shown in readable JSON and this browser does not write documents. The service account needs the corresponding Firestore database and document read permissions. Cloud Functions needs `cloudfunctions.functions.list` and returns names, state, region, runtime, entry point and URL; environment variables from the upstream API are excluded from the frontend response. Hosting needs `firebasehosting.sites.list`, `firebasehosting.sites.get` and permission to read releases; it lists site URLs and paginated releases. Release version configuration and release-user identities are excluded from the frontend response. The Auth response sent to the frontend includes only identity, contact, verification, account state, provider IDs and timestamps; password hashes, salts and custom claims are excluded even if IAM grants access to them. Auth needs `firebaseauth.users.get`. Buckets and object folders use Google Cloud Storage pagination. Files can be previewed and downloaded through the same native backend flow as other BaaS providers. Uploads use the native file picker, stream file bytes from Rust, and set `ifGenerationMatch=0` so an existing object is not overwritten. Uploads require `storage.objects.create`; project metadata, Firestore, Auth, Functions, Hosting and object browsing remain read-only. Disconnecting removes the saved service account credential and profile.

Relevant Firebase and Google Cloud documentation: [Firebase project API](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/get), [service accounts](https://firebase.google.com/docs/admin/setup), [Google service account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account), [list buckets](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/list), [list objects](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list), [get object media](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get), [upload objects](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert), [list Auth users](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/batchGet), [list Firestore databases](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/list), [list collection IDs](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/listCollectionIds), [list documents](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/listDocuments), [list Cloud Functions](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/list), [list Hosting sites](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/projects.sites/list), and [list Hosting releases](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.releases/list).

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
| Oracle | Row editing, transactions, table transactions, SQL catalog objects, DDL, PL/SQL debugger, compilation (warnings via ATTRIBUTE, optional `PLSQL_WARNINGS`), server output, object grants and administration, explain (PLAN_TABLE, adaptive plans via `display_map`; ANALYZE needs V$SESSION and V$SQL_PLAN_STATISTICS_ALL), sessions and locks with blocking chain, cancellation (break, then kill via MODULE/ACTION), connection info (capability probe), DBMS_XPLAN text view, data compare (LOB/LONG/XMLTYPE columns are not compared), bulk compile in dependency order (skips objects in use) |
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

## Server messages

Everything a statement returns besides rows is a `ServerMessage { level, message, detail }` (`src-tauri/src/db/server_output.rs`). The `execute_query` and `execute_query_with_params` commands run inside a capture scope for the connection key, whether or not the Server-Ausgabe toggle is on. Messages raised before an error are kept. `take_server_output` drains that buffer, followed by any adapter-specific output (Oracle DBMS_OUTPUT). Each transaction has its own buffer: `transaction_server_output(tx_id)` drains it and is removed with the transaction. Buffers keep the newest 2000 messages per key. Adapters call `server_output::emit`. Outside a scope, for example in MCP, CLI or metadata reads, `emit` does nothing.

| Family | Channel | Levels |
| --- | --- | --- |
| Postgres | Notices from the backend connection (`RAISE`) | `NOTICE`/`WARNING`/`INFO`/`DEBUG`/`LOG` as sent, detail = `DETAIL` |
| Oracle | DBMS_OUTPUT (unchanged) | `OUTPUT` |
| Mssql | INFO tokens (patched tiberius, see `vendor/tiberius/L8DB-PATCH.md`) | `PRINT` → `OUTPUT`; other info → `INFO` with `Meldung n, Ebene s, Status t[, Prozedur p], Zeile l`. SQL Server sends `RAISERROR` severity 10 as level 0 |
| Mysql/MariaDB | `SHOW WARNINGS` on the same session, only if the OK packet reports warnings, or after a server error (the error row itself is skipped) | `NOTE`/`WARNING`/`ERROR`, detail `Code n` |
| Cassandra/Scylla | Response warnings of each page | `WARNING` |
| Odbc | `SQL_SUCCESS_WITH_INFO` diagnostics (SQLSTATE class 01), which odbc-api only logs. The app logger captures them on the query thread instead of writing them to the log | `INFO`, detail `SQLSTATE s, nativer Fehler n` |
| Bigquery | Non-fatal `errors[]` of a finished query | `WARNING`, detail `Grund r` |
| Influxdb | `messages[]` of InfluxQL `/query` (v1 API) results | Level as sent, uppercased |
| Elasticsearch/OpenSearch | `Warning` response headers (deprecations) | `WARNING` |
| Athena | Scan and cost notice per query | `INFO` |

No channel: Sqlite, SqliteHttp, Duckdb, Clickhouse (HTTP), Snowflake (SQL API), Mongodb, Redis, Dynamodb and S3. Their `server_output` capability stays off.

Tests: `cargo test --lib server_output` covers the bound and timing. Lab checks (ignored): `notices_are_captured_per_statement_without_the_output_toggle` (Postgres lab), `live_info_messages_are_captured_per_statement` (`L8DB_SMOKE_MSSQL_URL`), `live_warnings_are_read_only_when_reported` (`L8DB_SMOKE_MYSQL_URL`/`L8DB_SMOKE_MARIADB_URL`; it counts `Com_show_warnings` to prove that statements without warnings add no round trip) and `oracle_transaction_output_lines_are_server_messages`.

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

Tests: the adapters are covered by mocked HTTP tests (`cargo test bigquery snowflake warehouse_auth`). `emulator_end_to_end` is ignored and runs against the BigQuery emulator when `L8DB_E2E_BIGQUERY_URL` is set, e.g. `bigquery://test?endpoint=http%3A%2F%2F127.0.0.1%3A9050&auth=none` with the `dataset1.table_a` fixture from `tests/lab/bigquery/data.yaml`: `docker run -d --platform linux/amd64 --name l8db-bq -p 127.0.0.1:9050:9050 -v "$PWD/tests/lab/bigquery/data.yaml:/data.yaml" ghcr.io/goccy/bigquery-emulator:latest --project=test --data-from-yaml=/data.yaml`. Snowflake has no emulator; only the mocked tests exist.

## Oracle connections

`oracle://user:pw@host:1521/service` connects through EZConnect. Query parameters:

- `?sid=ORCL` connects by SID instead of the service name.
- `?privilege=sysdba` (also `sysoper`, `sysbackup`, `sysdg`, `syskm`, `sysasm`) logs in with an administrative role; user `sys` defaults to SYSDBA.
- `?protocol=tcps` (or `?ssl=true`) uses TCPS; `&wallet=/path/to/wallet` sets `MY_WALLET_DIRECTORY` (quoted, so paths such as `C:\Program Files (x86)\…` work; `"` is rejected).
- In the connection editor (field mode), SID, role, TCPS and wallet are set in the Oracle section instead of typing the parameters.
- `?tns=ALIAS` or `?connect_string=…` passes a TNS alias or descriptor unchanged; the other parameters are then ignored.

Every session reports MODULE `l8db` and an ACTION such as `editor <pid>.<n>`, `meta …` or `transaction …` in V$SESSION. On connect, one PL/SQL probe reads version, container, identifier length, privileges and the readable V$ views; the result is cached per connection for 5 minutes and shown under Sitzungen & Locks → Verbindung (the SID shown there belongs to the metadata session, not the editor). Without rights on V$SESSION or V$LOCK, the session and lock views explain the missing grant instead of failing with ORA-00942. Input that contains only SQL*Plus commands (`DESC`, `SET`, `@file`) is rejected before it reaches the server. With V$SESSION_LONGOPS, the session list shows progress and remaining time next to the wait event.

- **Debugger:** DBMS_DEBUG reads each frame's line map (`GET_LINE_MAP`). Breakpoints on lines without an executable statement are skipped with a message instead of ending the session. Values in the inspector can be changed while the session is paused (`SET_VALUE`, PL/SQL literal syntax such as `42` or `'text'`); rejected values leave the variable unchanged and report the reason. PostgreSQL uses `pldbg_deposit_value` (not live-tested).
- **Explain:** with Oracle 12.1+ and read access to V$SQL and V$SQL_PLAN, the DBMS_XPLAN text also contains the cached cursor plan (`DISPLAY_CURSOR` via `DBMS_SQL_TRANSLATOR.SQL_ID`), when the statement already ran.
- **Transactions:** `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` tells whether the session has an open transaction before V$LOCKED_OBJECT is read. Without an open transaction there is nothing to list; with one but no V$ rights, the error says so.
- **Compiling:** warnings from `CREATE OR REPLACE` in the editor and from package spec, body and callers are shown together. Objects compiled with debug info (`PLSQL_DEBUG` or optimize level below 2) appear only in the invalid-objects view, not in the sidebar markers, the compile-all count or deployment checks.
- **Notices:** reconnects and extra result sets from `DBMS_SQL.RETURN_RESULT` are shown as a warning even when server output is off. Server output is read only when it is enabled.
- **SQL*Plus scripts:** session, transaction and command behaviour of script runs are described in [sqlplus-scripts.md](sqlplus-scripts.md).
- **Cancellation:** the editor call has an outer safety timeout (query timeout + 2 × connect timeout + 5 s); idle pings run under the connect timeout. The fallback kill only matches ACTIVE sessions of the same user and machine and is skipped when the call ends in the meantime.
- **Data compare:** LOB columns are read through locators, so a fetch batch does not buffer 500 full LOBs. Sync scripts split CLOBs into `TO_CLOB` pieces of 1000 characters and refuse XMLTYPE, SDO_GEOMETRY, BFILE, LONG and binary values above 2000 bytes.
- **SQL log:** passwords after `IDENTIFIED BY`, `REPLACE` and `PASSWORD '…'` are masked. Live checks: `oracle_live_tests` (ignored) run with `L8DB_SMOKE_ORACLE_URL` and, for kill and session tests, `L8DB_SMOKE_ORACLE_ADMIN_URL`.
- **Browser lab:** `bun run test:oracle-browser` starts the ignored bridge `oracle_browser_bridge` on 127.0.0.1:27031 (it calls the real Tauri command functions), Vite on port 1431 and the Oracle browser tests (`tests/oracle-*-browser.test.ts`). It expects the lab at `127.0.0.1:15219/FREEPDB1` with users `l8db` and `l8db_debug` (password `l8dbtest`) and Instant Client in `LD_LIBRARY_PATH`.

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

Live checks (ignored): `L8DB_SMOKE_ELASTICSEARCH_URL`, `L8DB_E2E_OPENSEARCH_URL`, `L8DB_SMOKE_INFLUXDB_URL` (v2), `L8DB_E2E_INFLUXDB3_URL` and `L8DB_SMOKE_SQLITEHTTP_URL` drive `http_live_tests`; they expect the seeded indices `logs`/`big`, measurements `cpu`/`mem` and a writable libSQL server. `bun run test:http-families` starts each server in Docker, seeds these fixtures and runs the checks one family at a time (`L8DB_HTTP_FAMILIES` selects a subset). D1 is covered by a mocked HTTP server in the unit tests.

`smoke_adapters_from_env` is ignored by default and runs configured `L8DB_SMOKE_<KIND>_URL` providers. It is not the mandatory integration suite. The isolated PostgreSQL/SSH suite is described in [integration-tests.md](integration-tests.md).


## Cloud accounts and managed profiles

Cloud accounts adds Neon, PlanetScale and SpacetimeDB accounts. Account credentials use backend-only keychain entries and are never returned by the general frontend secret commands. Database connections created from an account keep their ordinary connection ID; their database password is stored separately in the keychain.

- **Neon:** API keys work without an OAuth registration. OAuth appears only when an application-owned `L8DB_NEON_OAUTH_CLIENT_ID` is configured; an integration must register its redirect URI with Neon. Optional configuration: `L8DB_NEON_OAUTH_REDIRECT_PORT`, `L8DB_NEON_OAUTH_SCOPES`, `L8DB_NEON_OAUTH_CLIENT_SECRET`. The app does not reuse the neonctl client identity. The account browser lists organizations, projects, branches, databases and roles; branch tabs cover supported Auth, Storage and Functions APIs. Those APIs can depend on the project's beta access. Unknown Auth schemas produce an explicit error.
- **Neon over port 443:** choose WebSocket when creating the connection. `l8db_transport=neon-ws` forwards the PostgreSQL protocol through verified WSS and preserves sessions. There is no direct TCP fallback. The selected transport uses outer HTTPS encryption and sets PostgreSQL `channel_binding=disable`; the UI explains that choice. TCP connections retain their requested channel binding. This is not a stateless HTTP SQL adapter. Hosts must belong to `.neon.tech` or `.neon.build`.
- **PlanetScale:** a service token lists organizations, databases and branches. Creating reader credentials requires explicit confirmation and selects PostgreSQL or MySQL from the database's actual engine. l8db tracks and can revoke only credentials it issued. Removing the local account does not silently revoke remote credentials.
- **SpacetimeDB:** `spacetimedb://token:IDENTITY_TOKEN@maincloud.spacetimedb.com/database`. The placeholder username is `token`; the actual identity token belongs in the password field/keychain. Local fixture: `spacetimedb://token:TOKEN@127.0.0.1:13000/database?tls=false`. Cleartext is allowed only on loopback. Tables, schema and read-only SQL use the HTTP API; confirmed reducer calls are available from Cloud accounts. SQL responses are bounded to 10,000 rows/16 MiB. Dropping a request releases local work; no server-side cancellation acknowledgement is claimed.
- **JDBC:** create a profile under Drivers, import the vendor's JAR after accepting that it executes code, and select a full **JDK 17 or newer** (`JAVA_HOME` or `PATH`). A JRE alone cannot run the source bridge. Connections use only `jdbc:l8db:profile-id`; driver URLs and passwords remain in the backend profile. The catalog links to vendor sources and does not bundle proprietary drivers. Metadata, paged reads, prepared parameters, SQL and process cancellation are supported; generic row editing, transactions and catalog switching are not advertised. Limits: four Java processes, 192 MiB heap each, 60-second idle cleanup, 50,000 result rows and 8 MiB responses.
- **Workspace:** `workspace://profile-id/connection-id` refers to a login profile. The server holds the actual database credentials. See [team-hub.md](team-hub.md) for setup and limits.

JDBC and Workspace references are strict identifiers. Editing, imports, automation and startup preserve them without injecting ordinary database passwords, PostgreSQL options or SSH/proxy/command tunnels. Profiles manage those settings themselves.

Cloud lists keep at most five result pages. Queries do not poll on idle, window focus or reconnect; abandoned cache entries are discarded.

### Reproduce the new live fixtures

Run `bash scripts/test-spacetimedb-live.sh --setup-only` for the local lab. Its SDK fixture is in `tests/lab/spacetime/`; native ignored tests are in `src-tauri/src/db/spacetimedb_live_tests.rs` and read `L8DB_SPACETIME_LAB_CONFIG` from the script's protected configuration file. JDBC ignored tests use `JAVA_HOME`, `L8DB_JDBC_TEST_JAR` (H2), optional `L8DB_JDBC_POSTGRES_JAR`, and `L8DB_E2E_PG_URL`. Neon WSS ignored tests use a local PostgreSQL instance and a test WebSocket proxy; they do not establish access to the Neon cloud. Browser journeys mock the Tauri transport separately from native adapter live tests.


## Scope of the RexaDB comparison

The reference was [RexaDB source at 95504ab](https://github.com/RexaDB/RexaDB/tree/95504abdd0f807272af818f6edd007cf9349896a). Its advertised and implemented flows were compared with l8db's existing adapters, SQL editor, grid, ER diagrams, AI, automation, SSH, export and Supabase Studio. This change supplies the following gaps with an independent implementation; no RexaDB source files are included.

| Area | Existing l8db entry point | Added flow |
|---|---|---|
| Neon | PostgreSQL connection URL | Accounts, branch browser, branch management tabs and WSS transport on port 443 |
| Federation | Individual connections and comparison tools | Explicit sources from saved connections, local read-only SQL joins, schema/masking enforcement, cancellation and bounds |
| Team collaboration | Password-free connections.json distribution | Central login, encrypted shared connections, roles/grants, versioned shared queries, separate-author approval and audit |
| JDBC | Native adapters and ODBC | Vendor JAR catalog/import, backend profiles and bounded Java bridge |
| PlanetScale / SpacetimeDB | PlanetScale URL through MySQL/PostgreSQL | Account discovery, confirmed reader credentials; Spacetime HTTP metadata/read-only SQL and confirmed reducers |
| Supabase payments | Supabase Studio | Stripe test/live connection, project/account list scopes, admin actions, previewed setup, private billing schema and two Edge Functions |

Federation materializes declared source tables in memory and then executes SELECT/CTE/JOIN queries in a restricted SQLite sandbox. It does not offer a transactionally consistent snapshot across independent servers or while a source changes during materialization. Detected row-count changes, missing/null primary keys and repeated primary keys abort the load; changes that preserve the row count are not always detectable. Masked values become NULL before local SQL so expressions cannot recover them; that can change join results.

Limits are eight sources, 50,000 rows per source table, 100,000 rows/64 MiB of raw values across sources and 10,000 result rows/8 MiB. Each materialized alias additionally has at most 8,192 SQLite pages of 4 KiB, or 32 MiB including tables and B-tree overhead. This storage limit can be reached before 32 MiB of raw values; the 64 MiB input ceiling is not a guaranteed materialization capacity. Either limit produces an explicit size error and rolls back the failed batch.

Source data pages contain at most 512 rows. Larger sources require a known complete primary key and a supported ordered read strategy: PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, SQLite, DuckDB or SQLiteHTTP (D1/libSQL). Views, keyless sources and other adapter families are limited to a single page of at most 512 rows. All primary-key columns participate in paging order. Primary-key checks precede masking and retain only a 32-byte SHA-256 value per key, at most 50,000 for the current source. A single large source value can still exceed a batch budget before validation. The reported source-read count covers COUNT and data pages; additional schema/view/key metadata requests are separate.

Payments setup creates the private RLS-protected l8db_billing schema, a Stripe webhook and the l8db billing webhook/checkout Edge Functions after preview and confirmation. Admin mutations use project metadata checks and stable idempotency keys. Cloud credentials were not available in the development lab: cloud calls are covered by local HTTP mocks, function runtime tests, real PostgreSQL privilege tests and browser transport mocks. A live Stripe/Supabase deployment remains separate coverage. Stripe search is eventually consistent, project-only invoice lists can be empty because automatically generated invoices lack project metadata, and local disconnect does not remove the previously created webhook/function secrets. The app does not supply an application-user subscription-status API.

JDBC support is a generic adapter, not certification of every vendor's product or driver. OAuth needs an approved application registration, and beta cloud features depend on the provider account. Workspace SSO and a stateless PostgreSQL HTTP adapter are not part of this implementation.

### Verification record, 5 November 2026

The development lab was Debian 13 on x86_64, eight virtual CPUs, 16.8 GB RAM without swap, Bun 1.3.10 and Rust 1.99.0. TypeScript, the frontend production build, Cargo check and all-target Clippy passed. Clippy still reports warnings. Nine new Chromium feature journeys passed with mocked Tauri transport. Real native tests passed for JDBC with H2/PostgreSQL, PostgreSQL through a local WebSocket proxy, SpacetimeDB 2.14.1 and Workspace access to PostgreSQL. The billing SQL schema passed four real PostgreSQL privilege/RLS/order/idempotence tests. Both Edge Functions passed strict checking and real local HTTP execution under Deno 2.9.8; their cloud upstreams were mocked. See [PERFORMANCE.md](../PERFORMANCE.md) for measured workloads, latency and bounds.

The broad Bun run initially recorded 3,979 passes, 384 skips and eleven failed files. Corrections to the new code and an isolated frozen dependency install resolved eight failed files. The remaining three performance failures (`definition-merge`, `perf-split-groups`, `perf-ui-plugins`) were reproduced on the unchanged base commit. The existing browser run recorded fourteen passes, four failures and two skips; all four failures were reproduced on that base too: toolbar overflow, editor Undo, and ambiguous compare/data-compare button locators. Font access was corrected before that comparison. Production CSP/editor workers and the extension sandbox passed separately.

The full native unit run initially recorded 1,269 passes, four failures and 213 ignored tests. The new OAuth test had an incorrect expected PKCE vector; the corrected targeted test passed. Three unchanged MCP checks remain red: two latency budgets on this VM and a tools-list byte budget whose existing script-tool fixture exceeds the limit. Performance budgets were not increased, and these unrelated files were not modified. Ignored tests without a corresponding local lab do not count as passes. That Linux run supplied no macOS/Windows or live hosted Neon, PlanetScale, Stripe or Supabase result; the additional macOS evidence is recorded below.

The single Opus 5.5 High review reported two P1, six P2 and two P3 findings. The user approved all confirmed findings and Spacetime hardening in one fix round. That round passed 64 scoped Rust tests and seven JDBC/WSS/Spacetime/Workspace-PostgreSQL live tests. The updated JDBC browser journey passed 56 assertions with 64 profiles. On the subsequently merged source, TypeScript, the frontend production build, nine targeted frontend tests, Cargo check and default-feature library Clippy passed.

The optimized native binary at review-fix commit `3173c576` built with all default drivers, opt-level 3 and ThinLTO, using a local root-package override of 16 codegen units within 6 GiB. This was a binary build without installer bundles; tracked release settings were unchanged. The default one-unit build exceeded the local 6-GiB cap. The following MySQL live run failed at the two-second HTTP cancellation assertion. Commit `e63b345c` adds local cancellation/timeout handling for non-PostgreSQL Workspace operations; the current-source native MySQL retest was still missing at the Linux handoff and is completed below.

Additional Rust-test compilation attempts after concurrent development was merged were terminated by global or cgroup memory exhaustion, even with reduced debug information, finer codegen partitions and a separate attempt without the two optional DuckDB/ODBC features. These attempts produced no test results. The current-source development binary build was also stopped under severe host memory pressure. The user authorized a temporary Oracle-lab stop. Compilation resumed with default drivers, then was interrupted at the user’s request to relocate remaining work to the MacBook through T3 Code and Git. Oracle was restarted and its image healthcheck passed. No additional Rust-test result or current-source MySQL pass is claimed for that interrupted run. The transfer record is in [rexa-validation-handoff.json](rexa-validation-handoff.json).

### Native MacBook completion, 5 November 2026

The clean `development` checkout was fast-forwarded to `5d6d2f94`. Additional native evidence comes from macOS 27.0.1 (26A434), arm64, Apple M3 with eight logical CPUs and 16 GiB RAM, Bun 1.3.10 and Rust 1.99.0. A frozen-lockfile install left `bun.lock` unchanged. TypeScript/Vite and 28 distinct scoped frontend tests passed; the payments tests required the repository runner's separate-process isolation because a combined Bun invocation shared another file's transport mock. All 62 Rexa commands and five feature IDs remain registered and attached to the UI.

The selected MCP server/watch/artifact contracts passed 36 tests before the Workspace-only correction. Workspace then passed 13 regular tests and its ignored PostgreSQL live test against a new isolated PostgreSQL 18.6 container. Every Rust build used the default DuckDB/ODBC features and one build job; test compilation disabled incremental output and root-package debug information locally. The watch-specific ignored live fixture was not run. Existing Tiberius warnings remain; the macOS linker also warns that the large debug `__eh_frame` can affect exception-handling performance.

The initial Workspace run exposed a regression in `e63b345c`: the outer cancellation select dropped SQLite's asynchronous interrupt handler while blocking SQL continued. That run was terminated and is not reported as a suite pass. The same authorized fix round now preserves native PostgreSQL/SQLite cancellation and retains the local select for MySQL. The strengthened SQLite test confirms the native interruption error, a same-connection followup under two seconds, and idle cleanup. No additional review was performed.

A fresh `cargo build --locked --bin l8db` produced the current Mach-O arm64 binary with all default drivers. It uses the unoptimized development profile and existing build cache: only 24 GiB were free at the start, alongside 107 GiB of existing debug artifacts. This is not a current optimized release, installer or signing result. Tracked compiler settings were unchanged. Cargo check passed again after the correction.

`tests/workspaces-mysql-live.test.ts` then passed all 560 assertions against an own loopback-only MySQL 8.4.13 Linux/aarch64 container with performance_schema. Fifteen fresh sessions over 10,000 source rows measured 40.84/46.56 ms median/p95 against unchanged 100/250 ms limits. Responses retained 1,000 rows/28,882 bytes; four active slots rejected the fifth request with 429. HTTP cancellation took 2.49 ms against a two-second limit. Four server queries were still present at cancellation; after unlocking there were zero queries, connections and idle requests. See [PERFORMANCE.md](../PERFORMANCE.md) and the [structured record](rexa-validation-handoff.json) for counts and bounds. Own lab containers/volumes were removed; pre-existing labs were preserved.

The Mac client is native; the two database servers ran in Docker's Linux VM. These results are separate from CPU/heap simulation and the retained Linux JDBC/WSS/Spacetime/cloud-mock evidence. Hosted cloud services, Windows, native heap profiling and every JDBC vendor remain untested. The historical broad-suite failures above are not reclassified as passes.
