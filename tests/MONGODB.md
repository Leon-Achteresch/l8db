# MongoDB integration lab

The lab uses a separate, authenticated MongoDB 8 container bound to localhost. The credentials below are only for this disposable test container.

```sh
docker run -d --name l8db-mongodb-integration \
  -p 127.0.0.1:27018:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=l8db \
  -e MONGO_INITDB_ROOT_PASSWORD=l8db_test_only \
  mongo:8.0

docker exec l8db-mongodb-integration mongosh -u l8db -p l8db_test_only --quiet --eval 'db.runCommand({ping:1})'
```

For an existing stopped lab, use `docker start l8db-mongodb-integration` instead of creating another container.

## Adapter integration

Run from the repository root:

```sh
L8DB_E2E_MONGODB_URL='mongodb://l8db:l8db_test_only@127.0.0.1:27018/?authSource=admin' \
  cargo test --manifest-path src-tauri/Cargo.toml --lib mongodb_docker_integration -- --ignored --nocapture
```

The test creates uniquely named `l8db_e2e_*` databases and removes them on success. A failed assertion leaves its database available for inspection inside the isolated lab.

| Area | Assertions against MongoDB |
| --- | --- |
| Connection | Authenticated ping, rejected password, database discovery, URL default database, explicit database override, missing database error |
| Collections | Create, repeated create, list, empty collection, truncate preserving indexes, drop, database drop |
| Browsing | Field discovery with and without explicit schema, `_id`, nested fields, missing and null fields |
| Filtering | Equality, comparisons, nested BSON types, SQL-looking literal strings, malformed JSON and non-object rejection |
| Pagination | Limit, offset, ascending and descending sort, zero/negative limits, empty results retaining fields |
| Queries | Find over 257 documents with batch size 2, aggregation with batch size 3, automatic aggregation cursor, count, distinct |
| Writes | Insert, update, delete, affected counts, duplicate-key errors surfaced instead of false success |
| BSON | ObjectId, date, decimal, binary, lossless 64-bit integers and their filters |
| Indexes | Primary, unique and hashed index metadata, cursor pagination for index listing |
| Isolation | Switching databases on the shared pool, collection listing cursor pagination |

## Browser integration with the real Rust adapter

Seed only the two dedicated browser fixture databases:

```sh
docker exec -i l8db-mongodb-integration mongosh -u l8db -p l8db_test_only --quiet < tests/fixtures/mongodb-seed.js
```

Run the development server in one terminal:

```sh
bun run dev
```

Run the test-only adapter bridge in another terminal:

```sh
L8DB_MONGODB_BROWSER=1 \
L8DB_E2E_MONGODB_URL='mongodb://l8db:l8db_test_only@127.0.0.1:27018/l8db_browser_integration_long_database_name?authSource=admin' \
  cargo test --manifest-path src-tauri/Cargo.toml --lib mongodb_browser_bridge -- --ignored --nocapture
```

The bridge binds to `127.0.0.1:27019` and runs until stopped with Ctrl+C. It is compiled only for Rust tests. It substitutes the desktop transport and OS services; database operations go through the production Rust adapter into MongoDB. The test browser has its own disposable connection store. It does not change saved connections in the desktop application.

```sh
L8DB_MONGODB_BROWSER=1 bun test tests/mongodb-browser.test.ts
L8DB_MONGODB_BROWSER=1 L8DB_MONGODB_WEBKIT=1 bun test tests/mongodb-browser.test.ts
```

The browser suite covers the actual application: collection browsing, column and index tabs, creating an index, JSON filtering, invalid-filter recovery, editor queries returning all 257 documents, database switching, creating and dropping a collection, and hiding unsupported SQL actions. It checks overflow at 900, 1200 and 1600 pixels. A temporary capability override exercises the two-selector layout with long names; all MongoDB functional checks use the real registry.

Screenshots are written to `/tmp/l8db-mongo-sidebar.png`, `/tmp/l8db-scope-two-fields.png`, `/tmp/l8db-mongo-filter.png` and `/tmp/l8db-mongo-query.png`.

## General regression checks

```sh
bun run test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
```

## Scope

Verified locally with authenticated MongoDB 8, Chromium and WebKit. OS keychain integration, the native Tauri window/IPC, SSH, TLS certificates, Atlas SRV discovery and other MongoDB-compatible services are not exercised by this lab. MongoDB does not advertise inline row editing or transactions in the current provider; writes use JSON commands. Field discovery samples the first 50 documents and is not a schema guarantee.

After testing, stop the bridge and development server and optionally stop the container:

```sh
docker stop l8db-mongodb-integration
```

Connection for manual inspection:

```text
mongodb://l8db:l8db_test_only@127.0.0.1:27018/l8db_browser_integration_long_database_name?authSource=admin
```
